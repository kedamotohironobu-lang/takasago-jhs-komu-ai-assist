import { RAG_CONFIG } from './rag-config.mjs';
import { embedQuery } from './embedding-gemini.mjs';

function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function requireDb(env) {
  if (!env?.RAG_DB || typeof env.RAG_DB.prepare !== 'function') {
    throw fail('RAG_DB_NOT_CONFIGURED', 'RAG_DB が設定されていません。', 503);
  }
  return env.RAG_DB;
}

function requireVector(env) {
  if (!env?.RAG_VECTOR || typeof env.RAG_VECTOR.query !== 'function') {
    throw fail('RAG_VECTOR_NOT_CONFIGURED', 'RAG_VECTOR が設定されていません。', 503);
  }
  return env.RAG_VECTOR;
}

function cleanQuery(value, max = 1000) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function unique(items) {
  return [...new Set(items)];
}

function buildFtsQuery(input) {
  const q = cleanQuery(input, 500)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!q) return '';

  const runs = q.split(' ').filter(Boolean);
  const grams = [];

  for (const run of runs) {
    const chars = [...run];
    if (chars.length < 3) continue;

    if (chars.length === 3) {
      grams.push(chars.join(''));
      continue;
    }

    for (let i = 0; i <= chars.length - 3; i++) {
      grams.push(chars.slice(i, i + 3).join(''));
      if (grams.length >= 24) break;
    }
    if (grams.length >= 24) break;
  }

  return unique(grams)
    .slice(0, 24)
    .map(term => '"' + term.replace(/"/g, '""') + '"')
    .join(' OR ');
}

async function vectorSearch(env, query) {
  const vector = requireVector(env);
  const values = await embedQuery(env, query);
  const result = await vector.query(values, {
    topK:RAG_CONFIG.retrieval.vectorTopK,
    returnValues:false,
    returnMetadata:'none'
  });

  const matches = Array.isArray(result?.matches) ? result.matches : [];
  return matches.map((m, index) => ({
    chunkId:String(m?.id || ''),
    rank:index + 1,
    score:Number(m?.score || 0)
  })).filter(x => x.chunkId);
}

async function ftsSearch(env, query) {
  const db = requireDb(env);
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return { ftsQuery:'', matches:[] };

  try {
    const rows = await db.prepare(`
      SELECT chunk_id, document_id, bm25(chunks_fts) AS bm25_score
      FROM chunks_fts
      WHERE chunks_fts MATCH ?
      ORDER BY bm25_score ASC
      LIMIT ?
    `).bind(ftsQuery, RAG_CONFIG.retrieval.ftsTopK).all();

    return {
      ftsQuery,
      matches:(rows?.results || []).map((row, index) => ({
        chunkId:String(row?.chunk_id || ''),
        documentId:String(row?.document_id || ''),
        rank:index + 1,
        score:Number(row?.bm25_score || 0)
      })).filter(x => x.chunkId)
    };
  } catch (e) {
    console.error(JSON.stringify({code:'FTS_QUERY_FAILED',message:String(e?.message || '')}));
    return { ftsQuery, matches:[], error:'FTS_QUERY_FAILED' };
  }
}

function reciprocalRankFuse(vectorMatches, ftsMatches) {
  const k = RAG_CONFIG.retrieval.rrfK;
  const map = new Map();

  for (const hit of vectorMatches) {
    const item = map.get(hit.chunkId) || {
      chunkId:hit.chunkId,
      vectorRank:null,
      vectorScore:null,
      ftsRank:null,
      ftsScore:null,
      rrfScore:0
    };
    item.vectorRank = hit.rank;
    item.vectorScore = hit.score;
    item.rrfScore += 1 / (k + hit.rank);
    map.set(hit.chunkId, item);
  }

  for (const hit of ftsMatches) {
    const item = map.get(hit.chunkId) || {
      chunkId:hit.chunkId,
      vectorRank:null,
      vectorScore:null,
      ftsRank:null,
      ftsScore:null,
      rrfScore:0
    };
    item.ftsRank = hit.rank;
    item.ftsScore = hit.score;
    item.rrfScore += 1 / (k + hit.rank);
    map.set(hit.chunkId, item);
  }

  return [...map.values()]
    .sort((a, b) =>
      b.rrfScore - a.rrfScore ||
      Math.min(a.vectorRank || 9999, a.ftsRank || 9999) -
        Math.min(b.vectorRank || 9999, b.ftsRank || 9999) ||
      a.chunkId.localeCompare(b.chunkId)
    )
    .slice(0, RAG_CONFIG.retrieval.fusedTopK)
    .map((item, index) => ({ ...item, fusedRank:index + 1 }));
}

async function loadAuthoritativeCandidates(env, fused) {
  if (!fused.length) return [];
  const db = requireDb(env);
  const idsJson = JSON.stringify(fused.map(x => x.chunkId));

  const rows = await db.prepare(`
    SELECT
      c.chunk_id,
      c.document_id,
      c.chunk_no,
      c.page_from,
      c.page_to,
      c.sheet_name,
      c.slide_no,
      c.heading_path,
      c.text,
      c.is_active AS chunk_is_active,
      d.source_id,
      d.revision_no,
      d.is_current,
      d.title,
      d.file_name,
      d.version_label,
      d.category_id,
      d.owner_department,
      d.approval_status,
      d.status AS document_status,
      d.valid_from,
      d.valid_until,
      d.deleted_at,
      cat.name AS category_name,
      CASE
        WHEN c.is_active <> 1 THEN 'chunk_inactive'
        WHEN d.deleted_at IS NOT NULL THEN 'document_deleted'
        WHEN d.is_current <> 1 THEN 'document_not_current'
        WHEN d.status <> 'active' THEN 'document_status_' || d.status
        WHEN d.approval_status <> 'approved' THEN 'document_not_approved'
        WHEN d.valid_from IS NOT NULL AND date(d.valid_from) > date('now','+9 hours') THEN 'document_not_yet_valid'
        WHEN d.valid_until IS NOT NULL AND date(d.valid_until) < date('now','+9 hours') THEN 'document_expired'
        ELSE ''
      END AS exclusion_reason
    FROM chunks c
    JOIN documents d ON d.document_id = c.document_id
    LEFT JOIN categories cat ON cat.category_id = d.category_id
    WHERE c.chunk_id IN (
      SELECT CAST(value AS TEXT) FROM json_each(?)
    )
  `).bind(idsJson).all();

  const byId = new Map((rows?.results || []).map(row => [String(row.chunk_id), row]));

  return fused.map(item => {
    const row = byId.get(item.chunkId);
    if (!row) {
      return { ...item, exclusionReason:'chunk_missing', authoritative:false };
    }
    const exclusionReason = String(row.exclusion_reason || '');
    return {
      ...item,
      authoritative:!exclusionReason,
      exclusionReason,
      chunkId:String(row.chunk_id),
      documentId:String(row.document_id),
      chunkNo:Number(row.chunk_no || 0),
      pageFrom:row.page_from == null ? null : Number(row.page_from),
      pageTo:row.page_to == null ? null : Number(row.page_to),
      sheetName:String(row.sheet_name || ''),
      slideNo:row.slide_no == null ? null : Number(row.slide_no),
      headingPath:String(row.heading_path || ''),
      text:String(row.text || ''),
      sourceId:String(row.source_id || ''),
      revisionNo:Number(row.revision_no || 1),
      title:String(row.title || ''),
      fileName:String(row.file_name || ''),
      versionLabel:String(row.version_label || ''),
      categoryId:String(row.category_id || ''),
      categoryName:String(row.category_name || ''),
      ownerDepartment:String(row.owner_department || ''),
      validFrom:String(row.valid_from || ''),
      validUntil:String(row.valid_until || '')
    };
  });
}

function exactOverlapLength(left, right, max = 180) {
  const a = String(left || '');
  const b = String(right || '');
  const upper = Math.min(max, a.length, b.length);
  for (let size = upper; size >= 12; size--) {
    if (a.slice(-size) === b.slice(0, size)) return size;
  }
  return 0;
}

function mergeText(left, right) {
  const overlap = exactOverlapLength(left, right);
  return overlap ? left + right.slice(overlap) : left + '\n\n' + right;
}

function applyEvidenceGate(candidates) {
  const gate = RAG_CONFIG.retrieval.gate;
  const vectorOrdered = candidates
    .filter(x => x.authoritative && x.vectorRank && Number.isFinite(Number(x.vectorScore)))
    .sort((a,b) => Number(a.vectorRank || 9999) - Number(b.vectorRank || 9999));

  const topVectorScore = Number(vectorOrdered[0]?.vectorScore || 0);
  const secondVectorScore = Number(vectorOrdered[1]?.vectorScore || 0);
  const vectorLead = Math.max(0, topVectorScore - secondVectorScore);

  const corroborationCounts = new Map();
  for (const item of candidates) {
    if (!item.authoritative || !item.documentId) continue;
    const vectorScore = Number(item.vectorScore || 0);
    const vectorRank = Number(item.vectorRank || 0);
    const ftsRank = Number(item.ftsRank || 0);
    const qualifies =
      Boolean(vectorRank) &&
      Boolean(ftsRank) &&
      vectorScore >= gate.corroboratedHybridMinVectorScore &&
      vectorRank <= gate.corroboratedHybridMaxVectorRank &&
      ftsRank <= gate.corroboratedHybridMaxFtsRank;
    if (qualifies) {
      corroborationCounts.set(
        item.documentId,
        (corroborationCounts.get(item.documentId) || 0) + 1
      );
    }
  }

  return candidates.map(item => {
    if (!item.authoritative) {
      return {
        ...item,
        accepted:false,
        gateReason:item.exclusionReason || 'not_authoritative'
      };
    }

    const vectorScore = Number(item.vectorScore || 0);
    const vectorRank = Number(item.vectorRank || 0);
    const ftsRank = Number(item.ftsRank || 0);

    const hybridAccepted =
      Boolean(vectorRank) &&
      Boolean(ftsRank) &&
      vectorScore >= gate.hybridMinVectorScore &&
      vectorRank <= gate.hybridMaxVectorRank &&
      ftsRank <= gate.hybridMaxFtsRank;

    const corroboratedHybridAccepted =
      !hybridAccepted &&
      Boolean(item.documentId) &&
      Boolean(vectorRank) &&
      Boolean(ftsRank) &&
      vectorScore >= gate.corroboratedHybridMinVectorScore &&
      vectorRank <= gate.corroboratedHybridMaxVectorRank &&
      ftsRank <= gate.corroboratedHybridMaxFtsRank &&
      Number(corroborationCounts.get(item.documentId) || 0) >=
        gate.corroboratedHybridMinChunks;

    const vectorOnlyAccepted =
      vectorRank === 1 &&
      !ftsRank &&
      vectorScore >= gate.vectorOnlyMinScore &&
      vectorLead >= gate.vectorOnlyMinLead;

    let gateReason = 'below_threshold';
    if (hybridAccepted) gateReason = 'hybrid_agreement';
    else if (corroboratedHybridAccepted) gateReason = 'hybrid_multi_chunk_agreement';
    else if (vectorOnlyAccepted) gateReason = 'strong_vector_only';
    else if (!vectorRank && ftsRank) gateReason = 'fts_only_not_sufficient';
    else if (vectorRank && !ftsRank) gateReason = 'vector_only_below_threshold';

    return {
      ...item,
      accepted:hybridAccepted || corroboratedHybridAccepted || vectorOnlyAccepted,
      gateReason
    };
  });
}

function buildEvidence(candidates, requestedLimit) {
  const max = Math.max(
    1,
    Math.min(
      RAG_CONFIG.retrieval.maxEvidenceBlocks,
      Number(requestedLimit) || RAG_CONFIG.retrieval.defaultEvidenceBlocks
    )
  );

  const valid = candidates.filter(x => x.authoritative && x.accepted);
  const blocks = [];

  for (const item of valid) {
    const headingKey = item.headingPath || '';
    const mergeTarget = blocks.find(block =>
      block.documentId === item.documentId &&
      block.headingPath === headingKey &&
      (
        item.chunkNo === block.minChunkNo - 1 ||
        item.chunkNo === block.maxChunkNo + 1
      )
    );

    if (mergeTarget) {
      if (item.chunkNo < mergeTarget.minChunkNo) {
        mergeTarget.text = mergeText(item.text, mergeTarget.text);
        mergeTarget.minChunkNo = item.chunkNo;
      } else {
        mergeTarget.text = mergeText(mergeTarget.text, item.text);
        mergeTarget.maxChunkNo = item.chunkNo;
      }
      mergeTarget.chunkIds.push(item.chunkId);
      mergeTarget.rrfScore = Math.max(mergeTarget.rrfScore, item.rrfScore);
      if (item.vectorRank) mergeTarget.vectorRanks.push(item.vectorRank);
      if (item.ftsRank) mergeTarget.ftsRanks.push(item.ftsRank);
      continue;
    }

    blocks.push({
      documentId:item.documentId,
      sourceId:item.sourceId,
      revisionNo:item.revisionNo,
      title:item.title,
      fileName:item.fileName,
      versionLabel:item.versionLabel,
      categoryId:item.categoryId,
      categoryName:item.categoryName,
      ownerDepartment:item.ownerDepartment,
      headingPath:item.headingPath,
      pageFrom:item.pageFrom,
      pageTo:item.pageTo,
      sheetName:item.sheetName,
      slideNo:item.slideNo,
      minChunkNo:item.chunkNo,
      maxChunkNo:item.chunkNo,
      chunkIds:[item.chunkId],
      text:item.text,
      rrfScore:item.rrfScore,
      vectorRanks:item.vectorRank ? [item.vectorRank] : [],
      ftsRanks:item.ftsRank ? [item.ftsRank] : []
    });
  }

  blocks.sort((a, b) => b.rrfScore - a.rrfScore);

  const perDocument = new Map();
  const selected = [];
  let totalChars = 0;

  for (const block of blocks) {
    const count = perDocument.get(block.documentId) || 0;
    if (count >= RAG_CONFIG.retrieval.maxEvidenceBlocksPerDocument) continue;
    if (selected.length >= max) break;

    const remaining = RAG_CONFIG.chunking.maxEvidenceChars - totalChars;
    if (remaining <= 0) break;

    const text = block.text.slice(0, remaining);
    if (!text.trim()) continue;

    selected.push({ ...block, text });
    totalChars += text.length;
    perDocument.set(block.documentId, count + 1);
  }

  return selected;
}

async function hybridRetrieve(env, rawQuery, options = {}) {
  const query = cleanQuery(rawQuery);
  if (!query) throw fail('QUERY_REQUIRED', '質問を入力してください。');

  const [vectorMatches, fts] = await Promise.all([
    vectorSearch(env, query),
    ftsSearch(env, query)
  ]);

  const fused = reciprocalRankFuse(vectorMatches, fts.matches);
  const authoritativeCandidates = await loadAuthoritativeCandidates(env, fused);
  const candidates = applyEvidenceGate(authoritativeCandidates);
  const evidence = buildEvidence(candidates, options.evidenceLimit);

  return {
    query,
    config:{
      vectorTopK:RAG_CONFIG.retrieval.vectorTopK,
      ftsTopK:RAG_CONFIG.retrieval.ftsTopK,
      fusedTopK:RAG_CONFIG.retrieval.fusedTopK,
      rrfK:RAG_CONFIG.retrieval.rrfK,
      evidenceLimit:Math.max(
        1,
        Math.min(
          RAG_CONFIG.retrieval.maxEvidenceBlocks,
          Number(options.evidenceLimit) || RAG_CONFIG.retrieval.defaultEvidenceBlocks
        )
      )
    },
    diagnostics:{
      ftsQuery:fts.ftsQuery,
      ftsError:fts.error || '',
      vectorMatches,
      ftsMatches:fts.matches,
      gate:{
        thresholds:RAG_CONFIG.retrieval.gate,
        acceptedCount:candidates.filter(x => x.accepted).length
      },
      fusedCandidates:candidates.map(x => ({
        fusedRank:x.fusedRank,
        chunkId:x.chunkId,
        vectorRank:x.vectorRank,
        vectorScore:x.vectorScore,
        ftsRank:x.ftsRank,
        ftsScore:x.ftsScore,
        rrfScore:x.rrfScore,
        authoritative:Boolean(x.authoritative),
        exclusionReason:x.exclusionReason || '',
        accepted:Boolean(x.accepted),
        gateReason:x.gateReason || '',
        documentId:x.documentId || '',
        sourceId:x.sourceId || '',
        title:x.title || '',
        chunkNo:x.chunkNo || null
      }))
    },
    evidence,
    hasEvidence:evidence.length > 0,
    hasUsableEvidence:evidence.length > 0
  };
}

export {
  cleanQuery,
  buildFtsQuery,
  reciprocalRankFuse,
  applyEvidenceGate,
  buildEvidence,
  hybridRetrieve
};
