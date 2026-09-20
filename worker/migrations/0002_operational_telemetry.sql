-- STEP6-2 / STEP6-3 operational telemetry
-- Privacy-preserving: no question text, answer text, email, token, or IP address.

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
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
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
