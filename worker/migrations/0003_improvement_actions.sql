-- STEP6-7 improvement action cycle
-- No free-text notes, question text, answer text, email, IP, or secrets.

CREATE TABLE IF NOT EXISTS improvement_actions (
  action_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE,
  candidate_type TEXT NOT NULL,
  document_id TEXT,
  source_id TEXT,
  title TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('action','watch','info')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','done','dismissed')),
  created_by TEXT,
  updated_by TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_improvement_actions_status
  ON improvement_actions(status,updated_at);

CREATE INDEX IF NOT EXISTS idx_improvement_actions_document
  ON improvement_actions(document_id,status);
