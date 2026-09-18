-- STEP5 RAG core schema
-- High school FAQ: Drive = source of truth, D1 = RAG record/text source of truth.
-- Vectorize stores embeddings only; KV stores cache/state only.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  category_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  parent_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES categories(category_id)
);

CREATE TABLE IF NOT EXISTS documents (
  document_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),

  source_type TEXT NOT NULL CHECK (source_type IN ('drive', 'upload')),
  drive_file_id TEXT,
  file_name TEXT NOT NULL,
  title TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  category_id TEXT,
  owner_department TEXT,
  version_label TEXT,

  file_size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  page_count INTEGER,
  sheet_count INTEGER,
  slide_count INTEGER,

  content_hash_sha256 TEXT,
  source_modified_at TEXT,

  valid_from TEXT,
  valid_until TEXT,

  approval_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft', 'review_required', 'approved', 'rejected')),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'active', 'inactive', 'expired', 'error', 'source_missing')),

  approved_by TEXT,
  approved_at TEXT,

  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'extracting', 'extracted', 'ocr_required', 'error')),
  extracted_char_count INTEGER NOT NULL DEFAULT 0 CHECK (extracted_char_count >= 0),
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),

  vector_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (vector_status IN ('pending', 'indexing', 'ready', 'error')),
  vectorized_at TEXT,

  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,

  UNIQUE (source_id, revision_no),
  FOREIGN KEY (category_id) REFERENCES categories(category_id)
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_no INTEGER NOT NULL CHECK (chunk_no >= 1),

  page_from INTEGER,
  page_to INTEGER,
  sheet_name TEXT,
  slide_no INTEGER,
  heading_path TEXT,

  text TEXT NOT NULL,
  char_count INTEGER NOT NULL CHECK (char_count >= 1),
  content_hash_sha256 TEXT NOT NULL,

  vector_id TEXT UNIQUE,
  embedding_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (embedding_status IN ('pending', 'indexing', 'ready', 'error')),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (document_id, chunk_no),
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  metadata_json TEXT,
  request_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL
    CHECK (job_type IN ('register', 'update', 'drive_sync', 'reindex', 'delete', 'ocr')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'waiting_review', 'completed', 'failed', 'cancelled')),

  document_id TEXT,
  previous_document_id TEXT,
  source_id TEXT,
  drive_file_id TEXT,

  items_total INTEGER NOT NULL DEFAULT 0 CHECK (items_total >= 0),
  items_processed INTEGER NOT NULL DEFAULT 0 CHECK (items_processed >= 0),
  items_succeeded INTEGER NOT NULL DEFAULT 0 CHECK (items_succeeded >= 0),
  items_failed INTEGER NOT NULL DEFAULT 0 CHECK (items_failed >= 0),

  current_step TEXT,
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),

  estimated_chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (estimated_chunk_count >= 0),
  estimated_vector_dimensions INTEGER NOT NULL DEFAULT 0 CHECK (estimated_vector_dimensions >= 0),
  actual_vector_dimensions INTEGER NOT NULL DEFAULT 0 CHECK (actual_vector_dimensions >= 0),

  started_at TEXT,
  finished_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),

  error_code TEXT,
  error_message TEXT,

  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (document_id) REFERENCES documents(document_id),
  FOREIGN KEY (previous_document_id) REFERENCES documents(document_id)
);

-- One current revision per logical source.
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_one_current
  ON documents(source_id)
  WHERE is_current = 1;

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

-- FTS is intentionally maintained by application code.
-- This prevents staging revisions from becoming searchable before activation.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  title,
  category_name,
  heading_path,
  text,
  tokenize = 'trigram'
);

-- Initial categories.
INSERT OR IGNORE INTO categories
  (category_id, name, slug, parent_id, sort_order)
VALUES
  ('cat-schoolwork', '校務手続', 'schoolwork', NULL, 10),
  ('cat-travel', '出張・旅費', 'travel', 'cat-schoolwork', 20),
  ('cat-service', '服務', 'service', 'cat-schoolwork', 30),
  ('cat-leave', '休暇', 'leave', 'cat-schoolwork', 40),
  ('cat-documents', '文書', 'documents', 'cat-schoolwork', 50),
  ('cat-events', '行事', 'events', 'cat-schoolwork', 60),
  ('cat-ict', 'ICT', 'ict', 'cat-schoolwork', 70),
  ('cat-facilities', '施設・備品', 'facilities', 'cat-schoolwork', 80),
  ('cat-other', 'その他', 'other', NULL, 900);
