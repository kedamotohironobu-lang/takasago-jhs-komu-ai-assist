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

CREATE TABLE IF NOT EXISTS usage_events (
  event_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'generate',
  status TEXT NOT NULL,
  ai_called INTEGER NOT NULL DEFAULT 0 CHECK (ai_called IN (0,1)),
  provider TEXT,
  model TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  context_used INTEGER NOT NULL DEFAULT 0 CHECK (context_used IN (0,1)),
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS usage_sources (
  event_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  PRIMARY KEY (event_id, document_id),
  FOREIGN KEY (event_id) REFERENCES usage_events(event_id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

CREATE TABLE IF NOT EXISTS feedback_events (
  feedback_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('helpful','needs_improvement')),
  reason_code TEXT,
  UNIQUE (request_id)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_occurred
  ON usage_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_tool_status
  ON usage_events(tool_id,status,occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_request
  ON usage_events(request_id);
CREATE INDEX IF NOT EXISTS idx_usage_sources_document
  ON usage_sources(document_id,event_id);
CREATE INDEX IF NOT EXISTS idx_feedback_events_occurred
  ON feedback_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_feedback_events_rating
  ON feedback_events(rating,occurred_at);

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
  const previous = await queryOne(db, `
    SELECT
      document_id,revision_no,content_hash_sha256,source_modified_at,status,
      title,file_name,mime_type,category_id,owner_department,valid_from,valid_until
    FROM documents
    WHERE source_id=? AND is_current=1
    LIMIT 1
  `, valid.sourceId);

  const revisionNo = Number(revisionRow?.max_revision || 0) + 1;
  const documentId = `doc-${crypto.randomUUID()}`;
  const jobId = `job-${crypto.randomUUID()}`;
  const logId = `log-${crypto.randomUUID()}`;
  const contentHash = await sha256Hex(valid.chunked.sections.map(s => s.text).join('\n\n'));

  if (previous?.document_id && previous.status === 'active') {
    const sameContent =
      Boolean(previous.content_hash_sha256) &&
      String(previous.content_hash_sha256) === contentHash;

    const sameMetadata =
      String(previous.title || '') === String(valid.title || '') &&
      String(previous.file_name || '') === String(valid.fileName || '') &&
      String(previous.mime_type || '') === String(valid.mimeType || '') &&
      String(previous.category_id || '') === String(valid.categoryId || '') &&
      String(previous.owner_department || '') === String(valid.ownerDepartment || '') &&
      String(previous.valid_from || '') === String(valid.validFrom || '') &&
      String(previous.valid_until || '') === String(valid.validUntil || '');

    if (sameContent && sameMetadata) {
      const logId = `log-${crypto.randomUUID()}`;
      await db.batch([
        db.prepare(`
          UPDATE documents
          SET source_modified_at=?,
              file_size_bytes=?,
              last_synced_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
          WHERE document_id=?
        `).bind(
          valid.sourceModifiedAt || previous.source_modified_at || null,
          valid.fileSizeBytes,
          previous.document_id
        ),
        db.prepare(`
          INSERT INTO audit_logs (
            log_id,occurred_at,actor_id,action,entity_type,entity_id,summary,metadata_json
          )
          VALUES (?,CURRENT_TIMESTAMP,?,'source_unchanged','document',?,?,?)
        `).bind(
          logId,actorId,previous.document_id,
          `「${valid.title}」は本文変更なしのため再Embeddingを省略`,
          JSON.stringify({
            sourceId:valid.sourceId,
            revisionNo:Number(previous.revision_no || 1),
            sourceModifiedAt:valid.sourceModifiedAt || null,
            contentHash
          })
        )
      ]);

      return {
        ok:true,
        skipped:true,
        reason:'content_unchanged',
        documentId:previous.document_id,
        sourceId:valid.sourceId,
        revisionNo:Number(previous.revision_no || 1),
        message:'本文内容に変更がないため、新版作成と再Embeddingを省略しました。'
      };
    }
  }

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
      ) VALUES (?,?,'waiting_review',?,?,?,?,?,0,0,0,'staged',40,?,?,0,0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `).bind(
      jobId,previous?.document_id ? 'update' : 'register',
      documentId,previous?.document_id || null,valid.sourceId,valid.driveFileId || null,
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
      JSON.stringify({
        sourceId:valid.sourceId,
        revisionNo,
        previousDocumentId:previous?.document_id || null,
        jobType:previous?.document_id ? 'update' : 'register',
        sourceModifiedAt:valid.sourceModifiedAt || null,
        chunkCount:chunks.length
      })
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

  let vectors = [];
  let mutation = null;

  try {
    vectors = await Promise.all(chunks.map(async row => ({
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

    mutation = await vector.upsert(vectors);
  } catch (e) {
    const failedIds = JSON.stringify(chunks.map(row => row.chunk_id));
    await db.batch([
      db.prepare(`
        UPDATE chunks
        SET embedding_status='error',updated_at=CURRENT_TIMESTAMP
        WHERE chunk_id IN (
          SELECT CAST(value AS TEXT) FROM json_each(?)
        )
      `).bind(failedIds),
      db.prepare(`
        UPDATE documents
        SET status='error',vector_status='error',updated_at=CURRENT_TIMESTAMP
        WHERE document_id=?
      `).bind(documentId),
      db.prepare(`
        UPDATE sync_jobs
        SET status='failed',
            current_step='vectorizing',
            items_failed=items_failed+?,
            error_code='EMBEDDING_OR_VECTORIZE_FAILED',
            error_message=?,
            finished_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
        WHERE document_id=?
          AND status IN ('waiting_review','running','queued')
      `).bind(
        chunks.length,
        String(e?.message || 'Embedding / Vectorize処理に失敗しました。').slice(0,1000),
        documentId
      )
    ]);
    throw fail(
      'EMBEDDING_OR_VECTORIZE_FAILED',
      String(e?.message || 'Embedding / Vectorize処理に失敗しました。'),
      502
    );
  }

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
  const fetchedList = Array.isArray(fetched) ? fetched : [];
  const fetchedIds = new Set(fetchedList.map(v => v?.id));
  const missingSamples = sampleIds.filter(id => !fetchedIds.has(id));
  if (missingSamples.length) {
    throw fail('VECTOR_NOT_READY', 'Vectorizeへの反映待ちです。数秒待ってからもう一度実行してください。', 409, { missingSamples });
  }

  // getByIdsで取得できても、近傍検索用indexへの反映が少し遅れる場合がある。
  // finalize前に実際のqueryを1回行い、検索可能になったことまで確認する。
  if (fetchedList.length && Array.isArray(fetchedList[0]?.values) && fetchedList[0].values.length) {
    const queryProbe = await vector.query(fetchedList[0].values, {
      topK:Math.min(3, sampleIds.length || 1),
      returnValues:false,
      returnMetadata:'none'
    });
    const queryMatches = Array.isArray(queryProbe?.matches) ? queryProbe.matches : [];
    const queryable = queryMatches.some(m => sampleIds.includes(String(m?.id || '')));
    if (!queryable) {
      throw fail(
        'VECTOR_NOT_QUERYABLE_YET',
        'Vectorizeへの反映待ちです。ベクトルは保存済みですが、意味検索への反映を待っています。数秒待ってからもう一度実行してください。',
        409
      );
    }
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
    SET is_current=1,status='active',vector_status='ready',
        last_synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
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

async function getRagSourceState(env, sourceId) {
  const db = requireDb(env);
  const normalized = normalizeSourceId(sourceId);

  const current = await queryOne(db, `
    SELECT
      d.document_id,d.source_id,d.revision_no,d.is_current,d.source_type,d.drive_file_id,
      d.file_name,d.title,d.mime_type,d.category_id,c.name AS category_name,
      d.owner_department,d.version_label,d.file_size_bytes,d.page_count,d.sheet_count,d.slide_count,
      d.content_hash_sha256,d.source_modified_at,d.valid_from,d.valid_until,
      d.approval_status,d.status,d.extraction_status,d.extracted_char_count,d.chunk_count,
      d.vector_status,d.vectorized_at,d.last_synced_at,d.created_at,d.updated_at,d.deleted_at
    FROM documents d
    LEFT JOIN categories c ON c.category_id=d.category_id
    WHERE d.source_id=? AND d.is_current=1
    LIMIT 1
  `, normalized);

  const revisions = await queryOne(db,
    "SELECT COUNT(*) AS count FROM documents WHERE source_id=?",
    normalized
  );

  return {
    ok:true,
    sourceId:normalized,
    exists:Boolean(current),
    current:current || null,
    revisionCount:Number(revisions?.count || 0)
  };
}

async function markRagSourceMissing(env, sourceId, actorId = 'faq-admin') {
  const db = requireDb(env);
  const vector = requireVector(env);
  const normalized = normalizeSourceId(sourceId);

  const doc = await queryOne(db, `
    SELECT document_id,title,status,is_current
    FROM documents
    WHERE source_id=? AND is_current=1
    LIMIT 1
  `, normalized);

  if (!doc) {
    return { ok:true, sourceId:normalized, changed:false, reason:'CURRENT_DOCUMENT_NOT_FOUND' };
  }
  if (doc.status === 'source_missing') {
    return { ok:true, sourceId:normalized, changed:false, reason:'ALREADY_SOURCE_MISSING', documentId:doc.document_id };
  }

  const rows = await db.prepare(
    "SELECT vector_id FROM chunks WHERE document_id=? AND vector_id IS NOT NULL"
  ).bind(doc.document_id).all();
  const vectorIds = (rows?.results || []).map(r => r.vector_id).filter(Boolean);

  const logId = `log-${crypto.randomUUID()}`;
  await db.batch([
    db.prepare("DELETE FROM chunks_fts WHERE document_id=?").bind(doc.document_id),
    db.prepare("UPDATE chunks SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE document_id=?").bind(doc.document_id),
    db.prepare(`
      UPDATE documents
      SET status='source_missing',updated_at=CURRENT_TIMESTAMP
      WHERE document_id=?
    `).bind(doc.document_id),
    db.prepare(`
      INSERT INTO audit_logs (log_id,occurred_at,actor_id,action,entity_type,entity_id,summary,metadata_json)
      VALUES (?,CURRENT_TIMESTAMP,?,'source_missing','document',?,?,?)
    `).bind(
      logId,actorId,doc.document_id,
      `「${doc.title}」をDrive原本未確認として検索対象から除外`,
      JSON.stringify({ sourceId:normalized, vectorCount:vectorIds.length })
    )
  ]);

  const mutationIds = [];
  for (let i = 0; i < vectorIds.length; i += 1000) {
    try {
      const mutation = await vector.deleteByIds(vectorIds.slice(i, i + 1000));
      if (mutation?.mutationId) mutationIds.push(mutation.mutationId);
    } catch {
      // D1/FTS is authoritative; stale vectors are filtered by D1.
    }
  }

  return {
    ok:true,
    sourceId:normalized,
    documentId:doc.document_id,
    changed:true,
    status:'source_missing',
    deactivatedChunks:vectorIds.length,
    mutationIds
  };
}

async function softDeleteRagDocument(env, documentId, actorId = 'faq-admin') {
  const db = requireDb(env);
  const vector = requireVector(env);

  const doc = await queryOne(db, `
    SELECT document_id,source_id,revision_no,is_current,title,status,deleted_at
    FROM documents WHERE document_id=?
  `, documentId);
  if (!doc) throw fail('DOCUMENT_NOT_FOUND', '資料が見つかりません。', 404);
  if (Number(doc.is_current || 0) !== 1) {
    throw fail('DELETE_CURRENT_ONLY', '安全のため、現行版だけを削除対象にできます。', 409);
  }
  if (doc.deleted_at) {
    return { ok:true, changed:false, reason:'ALREADY_DELETED', documentId };
  }
  if (String(doc.status || '') !== 'active') {
    throw fail(
      'DELETE_ACTIVE_ONLY',
      '検索中のactive資料だけを論理削除できます。期限切れ・原本未確認・処理中の資料はそれぞれの状態管理を使用してください。',
      409
    );
  }

  const rows = await db.prepare(
    "SELECT vector_id FROM chunks WHERE document_id=? AND vector_id IS NOT NULL"
  ).bind(documentId).all();
  const vectorIds = (rows?.results || []).map(r => r.vector_id).filter(Boolean);

  const jobId = `job-${crypto.randomUUID()}`;
  const logId = `log-${crypto.randomUUID()}`;

  await db.batch([
    db.prepare("DELETE FROM chunks_fts WHERE document_id=?").bind(documentId),
    db.prepare(`
      UPDATE chunks
      SET is_active=0,updated_at=CURRENT_TIMESTAMP
      WHERE document_id=?
    `).bind(documentId),
    db.prepare(`
      UPDATE documents
      SET status='inactive',
          deleted_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP
      WHERE document_id=?
    `).bind(documentId),
    db.prepare(`
      INSERT INTO sync_jobs (
        job_id,job_type,status,document_id,source_id,
        items_total,items_processed,items_succeeded,items_failed,
        current_step,progress_percent,estimated_chunk_count,
        estimated_vector_dimensions,actual_vector_dimensions,
        retry_count,created_by,started_at,finished_at,created_at,updated_at
      )
      VALUES (
        ?,'delete','completed',?,?,?,
        ?,?,0,'soft_deleted',100,?,0,0,0,?,
        CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      )
    `).bind(
      jobId,documentId,doc.source_id,
      vectorIds.length,vectorIds.length,vectorIds.length,
      vectorIds.length,actorId
    ),
    db.prepare(`
      INSERT INTO audit_logs (
        log_id,occurred_at,actor_id,action,entity_type,entity_id,summary,metadata_json
      )
      VALUES (?,CURRENT_TIMESTAMP,?,'document_soft_deleted','document',?,?,?)
    `).bind(
      logId,actorId,documentId,
      `「${doc.title}」を論理削除しFAQ検索対象から除外`,
      JSON.stringify({
        sourceId:doc.source_id,
        revisionNo:Number(doc.revision_no || 1),
        vectorCount:vectorIds.length
      })
    )
  ]);

  const mutationIds = [];
  for (let i = 0; i < vectorIds.length; i += 1000) {
    try {
      const mutation = await vector.deleteByIds(vectorIds.slice(i,i+1000));
      if (mutation?.mutationId) mutationIds.push(mutation.mutationId);
    } catch {
      // D1/FTSが正本。残存vectorはauthoritative filterで除外される。
    }
  }

  return {
    ok:true,
    changed:true,
    documentId,
    sourceId:doc.source_id,
    status:'deleted',
    removedVectors:vectorIds.length,
    mutationIds
  };
}

async function restoreRagDocument(env, documentId, actorId = 'faq-admin') {
  const db = requireDb(env);

  const doc = await queryOne(db, `
    SELECT
      document_id,source_id,revision_no,is_current,title,approval_status,
      status,deleted_at,valid_until,chunk_count
    FROM documents
    WHERE document_id=?
  `, documentId);

  if (!doc) throw fail('DOCUMENT_NOT_FOUND', '資料が見つかりません。', 404);
  if (Number(doc.is_current || 0) !== 1) {
    throw fail('RESTORE_CURRENT_ONLY', '安全のため、現行版だけを復旧できます。', 409);
  }
  if (!doc.deleted_at) {
    throw fail('DOCUMENT_NOT_DELETED', 'この資料は論理削除されていません。', 409);
  }
  if (doc.approval_status !== 'approved') {
    throw fail('DOCUMENT_NOT_APPROVED', '承認済み資料だけ復旧できます。', 409);
  }

  if (doc.valid_until) {
    const expiry = await queryOne(db, `
      SELECT CASE
        WHEN date(?) < date('now','+9 hours') THEN 1
        ELSE 0
      END AS expired
    `, doc.valid_until);
    if (Number(expiry?.expired || 0) === 1) {
      throw fail(
        'RESTORE_EXPIRED_DOCUMENT',
        '有効期限を過ぎているため、そのまま復旧できません。Drive原本から有効期間を確認して新版登録してください。',
        409
      );
    }
  }

  const jobId = `job-${crypto.randomUUID()}`;
  const logId = `log-${crypto.randomUUID()}`;

  await db.batch([
    db.prepare("DELETE FROM chunks_fts WHERE document_id=?").bind(documentId),
    db.prepare(`
      UPDATE chunks
      SET embedding_status='pending',
          vector_id=NULL,
          is_active=0,
          updated_at=CURRENT_TIMESTAMP
      WHERE document_id=?
    `).bind(documentId),
    db.prepare(`
      UPDATE documents
      SET status='processing',
          vector_status='pending',
          vectorized_at=NULL,
          deleted_at=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE document_id=?
    `).bind(documentId),
    db.prepare(`
      INSERT INTO sync_jobs (
        job_id,job_type,status,document_id,source_id,
        items_total,items_processed,items_succeeded,items_failed,
        current_step,progress_percent,estimated_chunk_count,
        estimated_vector_dimensions,actual_vector_dimensions,
        retry_count,created_by,created_at,updated_at
      )
      VALUES (
        ?,'reindex','waiting_review',?,?,?,
        0,0,0,'restore_pending',40,?,?,0,0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      )
    `).bind(
      jobId,documentId,doc.source_id,
      Number(doc.chunk_count || 0),
      Number(doc.chunk_count || 0),
      Number(doc.chunk_count || 0) * RAG_CONFIG.embedding.dimensions,
      actorId
    ),
    db.prepare(`
      INSERT INTO audit_logs (
        log_id,occurred_at,actor_id,action,entity_type,entity_id,summary,metadata_json
      )
      VALUES (?,CURRENT_TIMESTAMP,?,'document_restore_started','document',?,?,?)
    `).bind(
      logId,actorId,documentId,
      `「${doc.title}」の復旧を開始`,
      JSON.stringify({
        sourceId:doc.source_id,
        revisionNo:Number(doc.revision_no || 1),
        jobId
      })
    )
  ]);

  return {
    ok:true,
    documentId,
    sourceId:doc.source_id,
    jobId,
    status:'processing',
    needsIndexing:true
  };
}

async function listRagJobs(env, limit = 100) {
  const db = requireDb(env);
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));

  const rows = await db.prepare(`
    SELECT
      j.job_id,j.job_type,j.status,j.document_id,j.previous_document_id,
      j.source_id,j.drive_file_id,j.items_total,j.items_processed,
      j.items_succeeded,j.items_failed,j.current_step,j.progress_percent,
      j.retry_count,j.error_code,j.error_message,j.created_by,
      j.started_at,j.finished_at,j.created_at,j.updated_at,
      d.title,d.revision_no,d.status AS document_status,d.deleted_at
    FROM sync_jobs j
    LEFT JOIN documents d ON d.document_id=j.document_id
    ORDER BY j.updated_at DESC
    LIMIT ${safeLimit}
  `).all();

  const now = Date.now();

  return {
    jobs:(rows?.results || []).map(row => {
      const updatedMs = Date.parse(String(row.updated_at || ''));
      const stalled =
        ['queued','running','waiting_review'].includes(String(row.status || '')) &&
        Number.isFinite(updatedMs) &&
        now - updatedMs > 24*60*60*1000;

      return {
        jobId:String(row.job_id || ''),
        jobType:String(row.job_type || ''),
        status:String(row.status || ''),
        documentId:String(row.document_id || ''),
        previousDocumentId:String(row.previous_document_id || ''),
        sourceId:String(row.source_id || ''),
        driveFileId:String(row.drive_file_id || ''),
        itemsTotal:Number(row.items_total || 0),
        itemsProcessed:Number(row.items_processed || 0),
        itemsSucceeded:Number(row.items_succeeded || 0),
        itemsFailed:Number(row.items_failed || 0),
        currentStep:String(row.current_step || ''),
        progressPercent:Number(row.progress_percent || 0),
        retryCount:Number(row.retry_count || 0),
        errorCode:String(row.error_code || ''),
        errorMessage:String(row.error_message || ''),
        createdBy:String(row.created_by || ''),
        startedAt:String(row.started_at || ''),
        finishedAt:String(row.finished_at || ''),
        createdAt:String(row.created_at || ''),
        updatedAt:String(row.updated_at || ''),
        title:String(row.title || ''),
        revisionNo:Number(row.revision_no || 0),
        documentStatus:String(row.document_status || ''),
        deletedAt:String(row.deleted_at || ''),
        stalled
      };
    })
  };
}

async function retryRagJob(env, jobId, actorId = 'faq-admin') {
  const db = requireDb(env);

  const job = await queryOne(db, `
    SELECT
      j.*,d.title,d.status AS document_status,d.deleted_at,d.approval_status
    FROM sync_jobs j
    LEFT JOIN documents d ON d.document_id=j.document_id
    WHERE j.job_id=?
  `, jobId);

  if (!job) throw fail('JOB_NOT_FOUND', '同期ジョブが見つかりません。', 404);
  if (!job.document_id) {
    throw fail('JOB_DOCUMENT_MISSING', 'このジョブには再試行対象の資料がありません。', 409);
  }
  if (job.deleted_at) {
    throw fail('JOB_DOCUMENT_DELETED', '論理削除済み資料のジョブは再試行できません。先に資料を復旧してください。', 409);
  }
  if (job.approval_status !== 'approved') {
    throw fail('DOCUMENT_NOT_APPROVED', '承認済み資料だけ再試行できます。', 409);
  }

  const updatedMs = Date.parse(String(job.updated_at || ''));
  const stalled =
    ['queued','running','waiting_review'].includes(String(job.status || '')) &&
    Number.isFinite(updatedMs) &&
    Date.now() - updatedMs > 24*60*60*1000;

  if (String(job.status || '') !== 'failed' && !stalled) {
    throw fail(
      'JOB_NOT_RETRYABLE',
      'failed、または24時間以上停滞したジョブだけ再試行できます。',
      409
    );
  }

  const counts = await queryOne(db, `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN embedding_status='ready' THEN 1 ELSE 0 END) AS ready
    FROM chunks
    WHERE document_id=?
  `, job.document_id);

  const total = Number(counts?.total || 0);
  const ready = Number(counts?.ready || 0);
  const progress = total
    ? Math.min(90, 40 + Math.floor((ready / total) * 50))
    : 40;

  const logId = `log-${crypto.randomUUID()}`;

  await db.batch([
    db.prepare(`
      UPDATE chunks
      SET embedding_status='pending',
          vector_id=NULL,
          is_active=0,
          updated_at=CURRENT_TIMESTAMP
      WHERE document_id=?
        AND embedding_status IN ('error','indexing')
    `).bind(job.document_id),
    db.prepare(`
      UPDATE documents
      SET status='processing',
          vector_status=CASE
            WHEN EXISTS(
              SELECT 1 FROM chunks
              WHERE document_id=? AND embedding_status='pending'
            ) THEN 'pending'
            ELSE vector_status
          END,
          updated_at=CURRENT_TIMESTAMP
      WHERE document_id=?
    `).bind(job.document_id,job.document_id),
    db.prepare(`
      UPDATE sync_jobs
      SET status='waiting_review',
          current_step='retry_pending',
          progress_percent=?,
          retry_count=retry_count+1,
          error_code=NULL,
          error_message=NULL,
          started_at=NULL,
          finished_at=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE job_id=?
    `).bind(progress,jobId),
    db.prepare(`
      INSERT INTO audit_logs (
        log_id,occurred_at,actor_id,action,entity_type,entity_id,summary,metadata_json
      )
      VALUES (?,CURRENT_TIMESTAMP,?,'sync_job_retried','sync_job',?,?,?)
    `).bind(
      logId,actorId,jobId,
      `「${job.title || job.source_id || job.document_id}」の同期ジョブを再試行`,
      JSON.stringify({
        documentId:job.document_id,
        sourceId:job.source_id || '',
        previousStatus:job.status,
        stalled,
        ready,
        total
      })
    )
  ]);

  return {
    ok:true,
    jobId,
    documentId:String(job.document_id || ''),
    sourceId:String(job.source_id || ''),
    ready,
    total,
    remaining:Math.max(0,total-ready),
    retryCount:Number(job.retry_count || 0)+1,
    needsIndexing:ready < total
  };
}

async function buildRagBackupManifest(env) {
  const db = requireDb(env);

  const [categories,documents,chunks,audit,jobs] = await Promise.all([
    db.prepare(`
      SELECT category_id,name,slug,parent_id,sort_order,is_active,created_at,updated_at
      FROM categories ORDER BY sort_order,name
    `).all(),
    db.prepare(`
      SELECT
        document_id,source_id,revision_no,is_current,source_type,drive_file_id,
        file_name,title,mime_type,category_id,owner_department,version_label,
        file_size_bytes,page_count,sheet_count,slide_count,content_hash_sha256,
        source_modified_at,valid_from,valid_until,approval_status,status,
        approved_by,approved_at,extraction_status,extracted_char_count,chunk_count,
        vector_status,vectorized_at,last_synced_at,created_at,updated_at,deleted_at
      FROM documents
      ORDER BY source_id,revision_no
    `).all(),
    db.prepare(`
      SELECT
        chunk_id,document_id,chunk_no,page_from,page_to,sheet_name,slide_no,
        heading_path,char_count,content_hash_sha256,vector_id,
        embedding_status,is_active,created_at,updated_at
      FROM chunks
      ORDER BY document_id,chunk_no
    `).all(),
    db.prepare(`
      SELECT
        log_id,occurred_at,actor_id,action,entity_type,entity_id,
        summary,metadata_json,request_id
      FROM audit_logs
      ORDER BY occurred_at
      LIMIT 5000
    `).all(),
    db.prepare(`
      SELECT
        job_id,job_type,status,document_id,previous_document_id,source_id,
        drive_file_id,items_total,items_processed,items_succeeded,items_failed,
        current_step,progress_percent,estimated_chunk_count,
        estimated_vector_dimensions,actual_vector_dimensions,retry_count,
        error_code,error_message,created_by,started_at,finished_at,
        created_at,updated_at
      FROM sync_jobs
      ORDER BY created_at
      LIMIT 5000
    `).all()
  ]);

  return {
    schema:'takasago-jhs-komu-ai-rag-backup-manifest-v1',
    generatedAt:new Date().toISOString(),
    containsChunkText:false,
    containsSecrets:false,
    sourceOfTruth:'Google Drive',
    recoveryNote:'資料本文はDrive原本から再抽出してください。このマニフェストは資料メタデータ・ハッシュ・監査・ジョブの復旧確認用です。',
    categories:categories?.results || [],
    documents:documents?.results || [],
    chunks:chunks?.results || [],
    auditLogs:(audit?.results || []).map(row => {
      let metadata = {};
      try { metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {}; } catch {}
      return {
        log_id:row.log_id,
        occurred_at:row.occurred_at,
        actor_id:row.actor_id,
        action:row.action,
        entity_type:row.entity_type,
        entity_id:row.entity_id,
        summary:row.summary,
        metadata,
        request_id:row.request_id
      };
    }),
    syncJobs:jobs?.results || []
  };
}

async function runRagMaintenance(env, actorId = 'system-maintenance') {
  const db = requireDb(env);
  const vector = requireVector(env);

  const expiredRows = await db.prepare(`
    SELECT document_id,source_id,title
    FROM documents
    WHERE is_current=1
      AND status='active'
      AND approval_status='approved'
      AND valid_until IS NOT NULL
      AND TRIM(valid_until) <> ''
      AND date(valid_until) < date('now','+9 hours')
    ORDER BY valid_until ASC
    LIMIT 500
  `).all();

  const expiredDocs = expiredRows?.results || [];
  const results = [];

  for (const doc of expiredDocs) {
    const vectorRows = await db.prepare(
      "SELECT vector_id FROM chunks WHERE document_id=? AND vector_id IS NOT NULL"
    ).bind(doc.document_id).all();
    const vectorIds = (vectorRows?.results || []).map(r => r.vector_id).filter(Boolean);

    const logId = `log-${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("DELETE FROM chunks_fts WHERE document_id=?").bind(doc.document_id),
      db.prepare("UPDATE chunks SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE document_id=?").bind(doc.document_id),
      db.prepare(`
        UPDATE documents
        SET status='expired',updated_at=CURRENT_TIMESTAMP
        WHERE document_id=?
      `).bind(doc.document_id),
      db.prepare(`
        INSERT INTO audit_logs (
          log_id,occurred_at,actor_id,action,entity_type,entity_id,summary,metadata_json
        )
        VALUES (?,CURRENT_TIMESTAMP,?,'document_expired','document',?,?,?)
      `).bind(
        logId,actorId,doc.document_id,
        `「${doc.title}」を有効期限切れとして検索対象から除外`,
        JSON.stringify({ sourceId:doc.source_id, vectorCount:vectorIds.length })
      )
    ]);

    const mutationIds = [];
    for (let i = 0; i < vectorIds.length; i += 1000) {
      try {
        const mutation = await vector.deleteByIds(vectorIds.slice(i, i + 1000));
        if (mutation?.mutationId) mutationIds.push(mutation.mutationId);
      } catch {
        // D1/FTSが正本。残存vectorはauthoritative filterでも除外される。
      }
    }

    results.push({
      documentId:String(doc.document_id || ''),
      sourceId:String(doc.source_id || ''),
      title:String(doc.title || ''),
      removedVectors:vectorIds.length,
      mutationIds
    });
  }

  const stalled = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM sync_jobs
    WHERE status IN ('queued','running','waiting_review')
      AND datetime(updated_at) < datetime('now','-24 hours')
  `).first();

  return {
    ok:true,
    jstDate:new Date(Date.now() + 9*60*60*1000).toISOString().slice(0,10),
    expiredCount:results.length,
    expired:results,
    stalledJobCount:Number(stalled?.count || 0)
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


async function cleanupRagTestSource(env, sourceId, actorId = 'faq-admin') {
  const db = requireDb(env);
  const vector = requireVector(env);
  const normalized = normalizeSourceId(sourceId);

  if (!normalized.startsWith('step5-test-')) {
    throw fail('TEST_CLEANUP_FORBIDDEN', 'テスト用sourceId以外はこの機能では削除できません。', 403);
  }

  const docs = await db.prepare(
    "SELECT document_id,title FROM documents WHERE source_id=? ORDER BY revision_no"
  ).bind(normalized).all();
  const documentRows = docs?.results || [];

  if (!documentRows.length) {
    return {
      ok:true,
      sourceId:normalized,
      deletedDocuments:0,
      deletedVectors:0,
      mutationIds:[]
    };
  }

  const vectors = await db.prepare(`
    SELECT c.vector_id
    FROM chunks c
    JOIN documents d ON d.document_id=c.document_id
    WHERE d.source_id=? AND c.vector_id IS NOT NULL
  `).bind(normalized).all();
  const vectorIds = (vectors?.results || []).map(r => r.vector_id).filter(Boolean);

  const logId = `log-${crypto.randomUUID()}`;
  await db.batch([
    db.prepare(`
      DELETE FROM chunks_fts
      WHERE document_id IN (
        SELECT document_id FROM documents WHERE source_id=?
      )
    `).bind(normalized),
    db.prepare("DELETE FROM sync_jobs WHERE source_id=?").bind(normalized),
    db.prepare("DELETE FROM documents WHERE source_id=?").bind(normalized),
    db.prepare(`
      INSERT INTO audit_logs (log_id,occurred_at,actor_id,action,entity_type,entity_id,summary,metadata_json)
      VALUES (?,CURRENT_TIMESTAMP,?,'test_source_cleaned','source',?,?,?)
    `).bind(
      logId,actorId,normalized,
      `STEP5テストsource「${normalized}」の全revisionを削除`,
      JSON.stringify({ documentCount:documentRows.length, vectorCount:vectorIds.length })
    )
  ]);

  const mutationIds = [];
  for (let i = 0; i < vectorIds.length; i += 1000) {
    try {
      const mutation = await vector.deleteByIds(vectorIds.slice(i, i + 1000));
      if (mutation?.mutationId) mutationIds.push(mutation.mutationId);
    } catch {
      // D1 cleanup is authoritative. Stray test vectors can be removed later.
    }
  }

  return {
    ok:true,
    sourceId:normalized,
    deletedDocuments:documentRows.length,
    deletedVectors:vectorIds.length,
    mutationIds
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
  getRagSourceState,
  markRagSourceMissing,
  softDeleteRagDocument,
  restoreRagDocument,
  listRagJobs,
  retryRagJob,
  buildRagBackupManifest,
  runRagMaintenance,
  cleanupRagTestDocument,
  cleanupRagTestSource
};
