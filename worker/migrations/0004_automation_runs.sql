-- STEP6-8 / STEP6-9 automation run tracking

CREATE TABLE IF NOT EXISTS automation_runs (
  run_id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','partial','error')),
  report_month TEXT,
  report_saved INTEGER NOT NULL DEFAULT 0 CHECK (report_saved IN (0,1)),
  notification_status TEXT,
  operations_health TEXT,
  improvement_action_count INTEGER NOT NULL DEFAULT 0,
  improvement_watch_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_created
  ON automation_runs(created_at);
