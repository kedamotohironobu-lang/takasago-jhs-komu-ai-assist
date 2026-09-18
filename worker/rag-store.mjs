import { RAG_CONFIG, vectorCapacityStatus } from './rag-config.mjs';
import { chunkDocument, cleanText } from './rag-chunker.mjs';
import { embedDocument } from './embedding-gemini.mjs';

const MAX_EXTRACTED_CHARS = 500000;
const MAX_CHUNKS_PER_DOCUMENT = 800;
const INDEX_BATCH_SIZE = 20;

function fail(code, message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

function requireDb(env) {
  if (!env?.RAG_DB || typeof env.RAG_DB.prepare !== 'function') {
    throw fail('RAG_DB_NOT_CONFIGURED', 'RAG_DB が設定されていません。', 503);
  }
  return env.RAG_DB;
}

function requireVector(env) {
  if (!env?.RAG_VECTOR || typeof env.RAG_VECTOR.upsert !== 'function') {
    throw fail('RAG_VECTOR_NOT_CONFIGURED', 'RAG_VECTOR が設定されていません。', 503);
  }
  return env.RAG_VECTOR;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).byteLength;
}

async function queryOne(db, sql, ...bindings) {
  const result = await db.prepare(sql).bind(...bindings).all();
  return result?.results?.[0] || null;
}

function normalizeSourceId(value) {
  const sourceId = cleanText(value, 160);
  if (!/^[A-Za-z0-9._-]{3,160}$/.test(sourceId)) {
    throw fail('INVALID_SOURCE_ID', 'sourceId は英数字・._-で3〜160文字にしてください。');
  }
  return sourceId;
}

function validateStagePayload(payload) {
  if (!payload || typeof payload !== 'object') throw fail('INVALID_JSON', 'リクエスト形式が正しくありません。');

  const sourceId = normalizeSourceId(payload.sourceId);
  const sourceType = String(payload.sourceType || 'upload');
  if (!['drive', 'upload'].includes(sourceType)) throw fail('INVALID_SOURCE_TYPE', 'sourceType が正しくありません。');

  const fileName = cleanText(payload.fileName || payload.title, 300);
  const title = cleanText(payload.title || payload.fileName, 300);
  const mimeType = cleanText(payload.mimeType || 'text/plain', 160);
  if (!fileName || !title) throw fail('DOCUMENT_TITLE_REQUIRED', '資料名が必要です。');

  const chunked = chunkDocument(payload);
  if (!chunked.chunks.length) throw fail('DOCUMENT_CONTENT_REQUIRED', '資料本文が必要です。');
  if (chunked.extractedCharCount > MAX_EXTRACTED_CHARS) {
    throw fail('DOCUMENT_TOO_LARGE', `抽出本文は${MAX_EXTRACTED_CHARS.toLocaleString()}文字以内にしてください。`, 413);
  }
  if (chunked.chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
    throw fail('TOO_MANY_CHUNKS', `1資料のチャンク数は${MAX_CHUNKS_PER_DOCUMENT}件以内にしてください。`, 413);
  }

  return {
    sourceId,
    sourceType,
    driveFileId:cleanText(payload.driveFileId, 300),
    fileName,
    title,
    mimeType,
    categoryId:cleanText(payload.categoryId || 'cat-other', 120),
    ownerDepartment:cleanText(payload.ownerDepartment, 160),
    versionLabel:cleanText(payload.versionLabel, 120),
    fileSizeBytes:Math.max(0, Number(payload.fileSizeBytes) || 0),
    pageCount:Number.isFinite(Number(payload.pageCount)) ? Math.max(0, Number(payload.pageCount)) : null,
    sheetCount:Number.isFinite(Number(payload.sheetCount)) ? Math.max(0, Number(payload.sheetCount)) : null,
    slideCount:Number.isFinite(Number(payload.slideCount)) ? Math.max(0, Number(payload.slideCount)) : null,
    sourceModifiedAt:cleanText(payload.sourceModifiedAt, 60),
    validFrom:cleanText(payload.validFrom, 60),
    validUntil:cleanText(payload.validUntil, 60),
    approved:payload.approved === true,
    chunked
  };
}

async function ensureRagSchemaExtras(env) {
  const db = requireDb(env);
  const sql = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_one_current
  ON documents(source_id) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_documents_drive_file
  ON documents(drive_file_id);
CREATE INDEX IF NOT EXISTS idx_documents_status
  ON documents(status, approval_status, is_current);
CREATE INDEX IF NOT EXISTS idx_documents_category
  ON documents(category_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_valid_until
  ON documents(valid_until);
CREATE INDEX IF NOT EXISTS idx_chunks_document_active
  ON chunks(document_id, is_active);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON chunks(embedding_status, is_active);
CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred
  ON audit_logs(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs(entity_type, entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status
  ON sync_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_source
  ON sync_jobs(source_id, created_at);

INSERT OR IGNORE INTO categories
(category_id, name, slug, parent_id, sort_order) VALUES
('cat-schoolwork', '校務手続', 'schoolwork', NULL, 10),
('cat-travel', '出張・旅費', 'travel', 'cat-schoolwork', 20),
('cat-service', '服務', 'service', 'cat-schoolwork', 30),
('cat-leave', '休暇', 'leave', 'cat-schoolwork', 40),
('cat-documents', '文書', 'documents', 'cat-schoolwork', 50),
('cat-events', '行事', 'events', 'cat-schoolwork', 60),
('cat-ict', 'ICT', 'ict', 'cat-schoolwork', 70),
('cat-facilities', '施設・備品', 'facilities', 'cat-schoolwork', 80),
('cat-other', 'その他', 'other', NULL, 900);

PRAGMA optimize;
`;
  const result = await db.exec(sql);
  const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name").all();
  const categories = await queryOne(db, "SELECT COUNT(*) AS count FROM categories WHERE is_active=1");
  return {
    ok:true,
    indexes:(indexes?.results || []).map(r => r.name),
    activeCategories:Number(categories?.count || 0),
    execCount:Number(result?.count || 0)
  };
}

async function getRagCapacity(env, additionalChunks = 0, additionalTextBytes = 0) {
  const db = requireDb(env);
  const active = await queryOne(db, `
    SELECT COUNT(*) AS count
    FROM chunks c
    JOIN documents d ON d.document_id=c.document_id
    WHERE c.is_active=1 AND d.is_current=1 AND d.status='active'
  `);
  const text = await queryOne(db, "SELECT COALESCE(SUM(length(CAST(text AS BLOB))),0) AS bytes FROM chunks");

  const activeChunks = Number(active?.count || 0);
  const currentTextBytes = Number(text?.bytes || 0);
  const projectedChunks = activeChunks + Math.max(0, Number(additionalChunks) || 0);
  const vector = vectorCapacityStatus(projectedChunks);

  // FTS・通常index・行メタデータを含む実DBサイズは本文サイズより大きくなる。
  // 登録前ガードでは安全側の概算として本文バイト数の4倍をworking setとして扱う。
  const projectedTextBytes = currentTextBytes + Math.max(0, Number(additionalTextBytes) || 0);
  const estimatedD1WorkingSetBytes = projectedTextBytes * 4;

  return {
    activeChunks,
    projectedChunks,
    vector,
    d1:{
      currentTextBytes,
      projectedTextBytes,
      estimatedWorkingSetBytes:estimatedD1WorkingSetBytes,
      warningBytes:RAG_CONFIG.capacity.d1WarningBytes,
      cautionBytes:RAG_CONFIG.capacity.d1CautionBytes,
      hardLimitBytes:RAG_CONFIG.capacity.d1DatabaseLimitBytes,
      estimateOnly:true
    }
  };
}

async function stageRagDocument(env, payload, actorId = 'faq-admin') {
  const db = requireDb(env);
  const valid = validateStagePayload(payload);

  const category = await queryOne(db,
    "SELECT category_id FROM categories WHERE category_id=? AND is_active=1",
    valid.categoryId
  );
  if (!category) throw fail('INVALID_CATEGORY', '指定された資料分類が見つかりません。');

  const additionalTextBytes = valid.chunked.chunks.reduce((sum, c) => sum + byteLength(c.text), 0);
  const capacity = await getRagCapacity(env, valid.chunked.chunks.length, additionalTextBytes);
  if (capacity.vector.usedDimensions > capacity.vector.limitDimensions) {
    throw fail('VECTOR_CAPACITY_EXCEEDED', 'Vectorize無料枠の保存容量を超えるため登録を開始できません。', 409, { capacity });
  }
  if (capacity.d1.estimatedWorkingSetBytes > capacity.d1.hardLimitBytes) {
    throw fail('D1_CAPACITY_RISK', 'D1容量上限を超える可能性が高いため登録を開始できません。', 409, { capacity });
  }

  const revisionRow = await queryOne(db,
    "SELECT COALESCE(MAX(revision_no),0) AS max_revision FROM documents WHERE source_id=?",
    valid.sourceId
  );
  const previous = await queryOne(db,
    "SELECT document_id FROM documents WHERE source_id=? AND is_current=1 LIMIT 1",
    valid.sourceId
  );

  const revisionNo = Number(revisionRow?.max_revision || 0) + 1;
  const documentId = `doc-${crypto.randomUUID()}`;
  const jobId = `job-${crypto.randomUUID()}`;
  const logId = `log-${crypto.randomUUID()}`;
  const contentHash = await sha256Hex(valid.chunked.sections.map(s => s.text).join('\n\n'));

  const chunks = await Promise.all(valid.chunked.chunks.map(async c => {
    const chunkId = `${documentId}-c${String(c.chunkNo).padStart(4, '0')}`;
    return {
      chunkId,
      chunkNo:c.chunkNo,
      pageFrom:c.pageFrom,
      pageTo:c.pageTo,
      sheetName:c.sheetName || '',
      slideNo:c.slideNo,
      headingPath:c.headingPath || '',
      text:c.text,
      charCount:c.charCount,
      contentHashSha256:await sha256Hex(c.text)
    };
  }));

  const approvalStatus = valid.approved ? 'approved' : 'review_required';
  const approvedBy = valid.approved ? actorId : null;
  const approvedAt = valid.approved ? new Date().toISOString() : null;

  const chunkJson = JSON.stringify(chunks);

  const statements = [
    db.prepare(`
      INSERT INTO documents (
        document_id,source_id,revision_no,is_current,source_type,drive_file_id,file_name,title,mime_type,
        category_id,owner_department,version_label,file_size_bytes,page_count,sheet_count,slide_count,
        content_hash_sha256,source_modified_at,valid_from,valid_until,approval_status,status,
        approved_by,approved_at,extraction_status,extracted_char_count,chunk_count,vector_status,
        last_synced_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'processing',?,?,'extracted',?,?,'pending',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `).bind(
      documentId,valid.sourceId,revisionNo,0,valid.sourceType,valid.driveFileId || null,valid.fileName,valid.title,valid.mimeType,
      valid.categoryId,valid.ownerDepartment || null,valid.versionLabel || null,valid.fileSizeBytes,valid.pageCount,valid.sheetCount,valid.slideCount,
      contentHash,valid.sourceModifiedAt || null,valid.validFrom || null,valid.validUntil || null,approvalStatus,
      approvedBy,approvedAt,valid.chunked.extractedCharCount,chunks.length
    ),
    db.prepare(`
      INSERT INTO sync_jobs (
        job_id,job_type,status,document_id,previous_document_id,source_id,drive_file_id,
        items_total,items_processed,items_succeeded,items_failed,current_step,progress_percent,
        estimated_chunk_count,estimated_vector_dimensions,actual_vector_dimensions,
        retry_count,created_by,created_at,updated_at
      ) VALUES (?,'register','waiting_review',?,?,?,?,?,0,0,0,'staged',40,?,?,0,0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `).bind(
      jobId,documentId,previous?.document_id || null,valid.sourceId,valid.driveFileId || null,
      chunks.length,chunks.length,chunks.length * RAG_CONFIG.embedding.dimensions,actorId
    ),
    db.prepare(`
      INSERT INTO chunks (
        chunk_id,document_id,chunk_no,page_from,page_to,sheet_name,slide_no,heading_path,
        text,char_count,content_hash_sha256,vector_id,embedding_status,is_active,created_at,updated_at
      )
      SELECT
        json_extract(value,'$.chunkId'),
        ?,
        CAST(json_extract(value,'$.chunkNo') AS INTEGER),
        json_extract(value,'$.pageFrom'),
        json_extract(value,'$.pageTo'),
        NULLIF(json_extract(value,'$.sheetName'),''),
        json_extract(value,'$.slideNo'),
        NULLIF(json_extract(value,'$.headingPath'),''),
        json_extract(value,'$.text'),
        CAST(json_extract(value,'$.charCount') AS INTEGER),
        json_extract(value,'$.contentHashSha256'),
        NULL,
        'pending',
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM json_each(?)
    `).bind(documentId, chunkJson),
    db.prepare(`
      INSERT INTO audit_logs (log_id,occurred_at,actor_id,action,entity_type,entity_id,summary,metadata_json)
      VALUES (?,CURRENT_TIMESTAMP,?,'document_staged','document',?, ?, ?)
    `).bind(
      logId,actorId,documentId,
      `「${valid.title}」をステージング登録`,
      JSON.stringify({ sourceId:valid.sourceId, revisionNo, chunkCount:chunks.length })
    )
  ];

  await db.batch(statements);

  return {
    ok:true,
    documentId,
    jobId,
    sourceId:valid.sourceId,
    revisionNo,
    previousDocumentId:previous?.document_id || null,
    approved:valid.approved,
    chunkCount:chunks.length,
    extractedCharCount:valid.chunked.extractedCharCount,
    capacity
  };
}

async function getRagDocumentStatus(env, documentId) {
  const db = requireDb(env);
  const doc = await queryOne(db, `
    SELECT document_id,source_id,revision_no,is_current,title,approval_status,status,
           extraction_status,extracted_char_count,chunk_count,vector_status,vectorized_at
    FROM documents WHERE document_id=?
  `, documentId);
  if (!doc) throw fail('DOCUMENT_NOT_FOUND', '資料が見つかりません。', 404);

  const counts = await queryOne(db, `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN embedding_status='ready' THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN embedding_status='error' THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) AS active
    FROM chunks WHERE document_id=?
  `, documentId);
  const fts = await queryOne(db, "SELECT COUNT(*) AS count FROM chunks_fts WHERE document_id=?", documentId);

  return {
    document:doc,
    chunks:{
      total:Number(counts?.total || 0),
      ready:Number(counts?.ready || 0),
      errors:Number(counts?.errors || 0),
      active:Number(counts?.active || 0),
      ftsCount:Number(fts?.count || 0)
    }
  };
}

async function indexNextRagDocument(env, documentId, limit = INDEX_BATCH_SIZE) {
  const db = requireDb(env);
  const vector = requireVector(env);
  const batchSize = Math.max(1, Math.min(INDEX_BATCH_SIZE, Number(limit) || INDEX_BATCH_SIZE));

  const doc = await queryOne(db, `
    SELECT document_id,source_id,revision_no,title,category_id,approval_status,status
    FROM documents WHERE document_id=?
  `, documentId);
  if (!doc) throw fail('DOCUMENT_NOT_FOUND', '資料が見つかりません。', 404);
  if (doc.approval_status !== 'approved') throw fail('DOCUMENT_NOT_APPROVED', '承認済み資料だけ検索インデックスを作成できます。', 409);
  if (!['processing','inactive'].includes(doc.status)) throw fail('INVALID_DOCUMENT_STATUS', 'この状態の資料はインデックス作成できません。', 409);

  const rows = await db.prepare(`
    SELECT chunk_id,chunk_no,heading_path,text
    FROM chunks
    WHERE document_id=? AND embedding_status='pending'
    ORDER BY chunk_no
    LIMIT ${batchSize}
  `).bind(documentId).all();

  const chunks = rows?.results || [];
  if (!chunks.length) {
    await db.batch([
      db.prepare("UPDATE documents SET vector_status='ready',vectorized_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE document_id=?").bind(documentId),
      db.prepare("UPDATE sync_jobs SET current_step='vector_ready',progress_percent=90,updated_at=CURRENT_TIMESTAMP WHERE document_id=? AND status IN ('waiting_review','running')").bind(documentId)
    ]);
    return { ok:true, documentId, processed:0, remaining:0, done:true };
  }

  await db.batch([
    db.prepare("UPDATE documents SET vector_status='indexing',updated_at=CURRENT_TIMESTAMP WHERE document_id=?").bind(documentId),
    db.prepare("UPDATE sync_jobs SET status='running',current_step='vectorizing',updated_at=CURRENT_TIMESTAMP WHERE document_id=? AND status IN ('waiting_review','running')").bind(documentId)
  ]);

  const vectors = await Promise.all(chunks.map(async row => ({
    id:row.chunk_id,
    values:await embedDocument(env, {
      title:doc.title,
      heading:row.heading_path || '',
      text:row.text
    }),
    metadata:{
      documentId:doc.document_id,
      chunkId:row.chunk_id,
      sourceId:doc.source_id,
      revisionNo:Number(doc.revision_no || 1),
      categoryId:doc.category_id || 'cat-other',
      title:doc.title
    }
  })));

  const mutation = await vector.upsert(vectors);
  const readyIds = JSON.stringify(chunks.map(row => row.chunk_id));

  await db.prepare(`
    UPDATE chunks
    SET embedding_status='ready',vector_id=chunk_id,updated_at=CURRENT_TIMESTAMP
    WHERE chunk_id IN (
      SELECT CAST(value AS TEXT) FROM json_each(?)
    )
  `).bind(readyIds).run();

  const counts = await queryOne(db, `
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN embedding_status='ready' THEN 1 ELSE 0 END) AS ready
    FROM chunks WHERE document_id=?
  `, documentId);

  const total = Number(counts?.total || 0);
  const ready = Number(counts?.ready || 0);
  const remaining = Math.max(0, total - ready);
  const progress = total ? Math.min(90, 40 + Math.floor((ready / total) * 50)) : 90;

  await db.prepare(`
    UPDATE sync_jobs
    SET items_processed=?,items_succeeded=?,current_step=?,progress_percent=?,actual_vector_dimensions=?,
        updated_at=CURRENT_TIMESTAMP
    WHERE document_id=? AND status IN ('waiting_review','running')
  `).bind(
    ready,ready,remaining ? 'vectorizing' : 'vector_ready',progress,
    ready * RAG_CONFIG.embedding.dimensions,documentId
  ).run();

  if (!remaining) {
    await db.prepare("UPDATE documents SET vector_status='ready',vectorized_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE document_id=?")
      .bind(documentId).run();
  }

  return {
    ok:true,
    documentId,
    processed:chunks.length,
    ready,
    total,
    remaining,
    done:remaining === 0,
    mutationId:mutation?.mutationId || null
  };
}

async function finalizeRagDocument(env, documentId, actorId = 'faq-admin') {
  const db = requireDb(env);
  const vector = requireVector(env);

  const doc = await queryOne(db, `
    SELECT document_id,source_id,revision_no,title,approval_status,status,vector_status
    FROM documents WHERE document_id=?
  `, documentId);
  if (!doc) throw fail('DOCUMENT_NOT_FOUND', '資料が見つかりません。', 404);
  if (doc.approval_status !== 'approved') throw fail('DOCUMENT_NOT_APPROVED', '承認済み資料だけ有効化できます。', 409);

  const counts = await queryOne(db, `
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN embedding_status='ready' THEN 1 ELSE 0 END) AS ready
    FROM chunks WHERE document_id=?
  `, documentId);
  const total = Number(counts?.total || 0);
  const ready = Number(counts?.ready || 0);
  if (!total || ready !== total) throw fail('VECTOR_INDEX_INCOMPLETE', 'すべてのチャンクのVectorize登録が完了していません。', 409, { total, ready });

  const sampleRows = await db.prepare(`
    SELECT vector_id FROM chunks
    WHERE document_id=? AND vector_id IS NOT NULL
    ORDER BY chunk_no
    LIMIT 3
  `).bind(documentId).all();
  const sampleIds = (sampleRows?.results || []).map(r => r.vector_id).filter(Boolean);
  const fetched = sampleIds.length ? await vector.getByIds(sampleIds) : [];
  const fetchedIds = new Set((Array.isArray(fetched) ? fetched : []).map(v => v?.id));
  const missingSamples = sampleIds.filter(id => !fetchedIds.has(id));
  if (missingSamples.length) {
    throw fail('VECTOR_NOT_READY', 'Vectorizeへの反映待ちです。数秒待ってからもう一度実行してください。', 409, { missingSamples });
  }

  const previous = await queryOne(db, `
    SELECT document_id FROM documents
    WHERE source_id=? AND is_current=1 AND document_id<>?
    LIMIT 1
  `, doc.source_id, documentId);

  let oldVectorIds = [];
  if (previous?.document_id) {
    const oldRows = await db.prepare("SELECT vector_id FROM chunks WHERE document_id=? AND vector_id IS NOT NULL")
      .bind(previous.document_id).all();
    oldVectorIds = (oldRows?.results || []).map(r => r.vector_id).filter(Boolean);
  }

  const logId = `log-${crypto.randomUUID()}`;
  const statements = [];

  statements.push(db.prepare("DELETE FROM chunks_fts WHERE document_id=?").bind(documentId));

  if (previous?.document_id) {
    statements.push(db.prepare("DELETE FROM chunks_fts WHERE document_id=?").bind(previous.document_id));
    statements.push(db.prepare("UPDATE chunks SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE document_id=?").bind(previous.document_id));
    statements.push(db.prepare("UPDATE documents SET is_current=0,status='inactive',updated_at=CURRENT_TIMESTAMP WHERE document_id=?").bind(previous.document_id));
  }

  statements.push(db.prepare("UPDATE chunks SET is_active=1,updated_at=CURRENT_TIMESTAMP WHERE document_id=?").bind(documentId));
  statements.push(db.prepare(`
    INSERT INTO chunks_fts (chunk_id,document_id,title,category_name,heading_path,text)
    SELECT c.chunk_id,c.document_id,d.title,COALESCE(cat.name,''),COALESCE(c.heading_path,''),c.text
    FROM chunks c
    JOIN documents d ON d.document_id=c.document_id
    LEFT JOIN categories cat ON cat.category_id=d.category_id
    WHERE c.document_id=? AND c.is_active=1
  `).bind(documentId));
  statements.push(db.prepare(`
    UPDATE documents
    SET is_current=1,status='active',vector_status='ready',updated_at=CURRENT_TIMESTAMP
    WHERE document_id=?
  `).bind(documentId));
  statements.push(db.prepare(`
    UPDATE sync_jobs
    SET status='completed',current_step='completed',progress_percent=100,
        items_processed=items_total,items_succeeded=items_total,finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE document_id=? AND status IN ('waiting_review','running')
  `).bind(documentId));
  statements.push(db.prepare(`
    INSERT INTO audit_logs (log_id,occurred_at,actor_id,action,entity_type,entity_id,summary,metadata_json)
    VALUES (?,CURRENT_TIMESTAMP,?,'document_activated','document',?,?,?)
  `).bind(
    logId,actorId,documentId,`「${doc.title}」をRAGで有効化`,
    JSON.stringify({ sourceId:doc.source_id, revisionNo:doc.revision_no, previousDocumentId:previous?.document_id || null })
  ));

  await db.batch(statements);

  let cleanupMutationId = null;
  let cleanupWarning = '';
  if (oldVectorIds.length) {
    try {
      const cleanup = await vector.deleteByIds(oldVectorIds.slice(0, 1000));
      cleanupMutationId = cleanup?.mutationId || null;
    } catch {
      cleanupWarning = 'OLD_VECTOR_CLEANUP_PENDING';
    }
  }

  return {
    ok:true,
    documentId,
    sourceId:doc.source_id,
    revisionNo:Number(doc.revision_no || 1),
    activeChunks:total,
    previousDocumentId:previous?.document_id || null,
    oldVectorCleanupCount:oldVectorIds.length,
    cleanupMutationId,
    cleanupWarning
  };
}

async function cleanupRagTestDocument(env, documentId, actorId = 'faq-admin') {
  const db = requireDb(env);
  const vector = requireVector(env);

  const doc = await queryOne(db,
    "SELECT document_id,source_id,title FROM documents WHERE document_id=?",
    documentId
  );
  if (!doc) throw fail('DOCUMENT_NOT_FOUND', '資料が見つかりません。', 404);
  if (!String(doc.source_id || '').startsWith('step5-test-')) {
    throw fail('TEST_CLEANUP_FORBIDDEN', 'テスト用資料以外はこの機能では削除できません。', 403);
  }

  const rows = await db.prepare(
    "SELECT vector_id FROM chunks WHERE document_id=? AND vector_id IS NOT NULL"
  ).bind(documentId).all();
  const vectorIds = (rows?.results || []).map(r => r.vector_id).filter(Boolean);

  const logId = `log-${crypto.randomUUID()}`;
  await db.batch([
    db.prepare("DELETE FROM chunks_fts WHERE document_id=?").bind(documentId),
    db.prepare("DELETE FROM sync_jobs WHERE document_id=? OR previous_document_id=?").bind(documentId, documentId),
    db.prepare("DELETE FROM documents WHERE document_id=?").bind(documentId),
    db.prepare(`
      INSERT INTO audit_logs (log_id,occurred_at,actor_id,action,entity_type,entity_id,summary,metadata_json)
      VALUES (?,CURRENT_TIMESTAMP,?,'test_document_cleaned','document',?,?,?)
    `).bind(
      logId,actorId,documentId,`STEP5テスト資料「${doc.title}」を削除`,
      JSON.stringify({ sourceId:doc.source_id, vectorCount:vectorIds.length })
    )
  ]);

  let mutationId = null;
  if (vectorIds.length) {
    try {
      const mutation = await vector.deleteByIds(vectorIds.slice(0, 1000));
      mutationId = mutation?.mutationId || null;
    } catch {
      // D1 cleanup is authoritative. A stray test vector is harmless and can be deleted later.
    }
  }

  return {
    ok:true,
    documentId,
    sourceId:doc.source_id,
    deletedVectorCount:vectorIds.length,
    mutationId
  };
}

export {
  MAX_EXTRACTED_CHARS,
  MAX_CHUNKS_PER_DOCUMENT,
  INDEX_BATCH_SIZE,
  ensureRagSchemaExtras,
  getRagCapacity,
  stageRagDocument,
  getRagDocumentStatus,
  indexNextRagDocument,
  finalizeRagDocument,
  cleanupRagTestDocument
};
