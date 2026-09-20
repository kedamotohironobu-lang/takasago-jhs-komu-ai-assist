const MAX_SOURCE_DOCUMENTS = 8;
const FEEDBACK_REASONS = new Set([
  'wrong_source',
  'answer_incomplete',
  'hard_to_understand',
  'outdated',
  'other'
]);

function requireDb(env) {
  if (!env?.RAG_DB || typeof env.RAG_DB.prepare !== 'function') {
    const e = new Error('RAG_DB が設定されていません。');
    e.code = 'RAG_DB_NOT_CONFIGURED';
    e.status = 503;
    throw e;
  }
  return env.RAG_DB;
}

async function ensureOperationalSchema(env) {
  const db = requireDb(env);
  await db.exec(`
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
`);
  return { ok:true };
}

function normalizeSources(sourceDocumentIds) {
  return [...new Set(
    (Array.isArray(sourceDocumentIds) ? sourceDocumentIds : [])
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .slice(0, MAX_SOURCE_DOCUMENTS)
  )];
}

async function recordUsageEvent(env, payload = {}) {
  const db = requireDb(env);
  await ensureOperationalSchema(env);

  const eventId = 'use-' + crypto.randomUUID();
  const requestId = String(payload.requestId || '').trim();
  if (!requestId) return { ok:false, skipped:true, reason:'request_id_missing' };

  const toolId = String(payload.toolId || 'unknown').slice(0,80);
  const status = String(payload.status || 'unknown').slice(0,80);
  const provider = String(payload.provider || '').slice(0,120) || null;
  const model = String(payload.model || '').slice(0,160) || null;
  const errorCode = String(payload.errorCode || '').slice(0,160) || null;
  const latencyMs = Math.max(0, Math.min(300000, Number(payload.latencyMs) || 0));
  const evidenceCount = Math.max(0, Math.min(100, Number(payload.evidenceCount) || 0));
  const documentIds = normalizeSources(payload.sourceDocumentIds);

  const statements = [
    db.prepare(`
      INSERT INTO usage_events (
        event_id,request_id,tool_id,event_type,status,ai_called,
        provider,model,latency_ms,evidence_count,context_used,error_code
      )
      VALUES (?,?,?,'generate',?,?,?,?,?,?,?,?)
    `).bind(
      eventId,
      requestId,
      toolId,
      status,
      payload.aiCalled ? 1 : 0,
      provider,
      model,
      latencyMs,
      evidenceCount,
      payload.contextUsed ? 1 : 0,
      errorCode
    )
  ];

  for (const documentId of documentIds) {
    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO usage_sources (event_id,document_id)
        VALUES (?,?)
      `).bind(eventId,documentId)
    );
  }

  await db.batch(statements);
  return { ok:true, eventId };
}

async function submitFeedback(env, payload = {}) {
  const db = requireDb(env);
  await ensureOperationalSchema(env);

  const requestId = String(payload.requestId || '').trim();
  const rating = String(payload.rating || '').trim();
  const reason = String(payload.reasonCode || '').trim();

  if (!requestId) {
    const e = new Error('requestId が必要です。');
    e.code = 'REQUEST_ID_REQUIRED';
    e.status = 400;
    throw e;
  }
  if (!['helpful','needs_improvement'].includes(rating)) {
    const e = new Error('feedback rating が正しくありません。');
    e.code = 'INVALID_FEEDBACK_RATING';
    e.status = 400;
    throw e;
  }
  if (rating === 'needs_improvement' && reason && !FEEDBACK_REASONS.has(reason)) {
    const e = new Error('feedback reason が正しくありません。');
    e.code = 'INVALID_FEEDBACK_REASON';
    e.status = 400;
    throw e;
  }

  const usage = await db.prepare(`
    SELECT request_id
    FROM usage_events
    WHERE request_id=?
      AND datetime(occurred_at) >= datetime('now','-30 days')
    LIMIT 1
  `).bind(requestId).first();

  if (!usage) {
    const e = new Error('評価対象の利用記録を確認できません。');
    e.code = 'FEEDBACK_TARGET_NOT_FOUND';
    e.status = 404;
    throw e;
  }

  const feedbackId = 'fb-' + crypto.randomUUID();
  await db.prepare(`
    INSERT INTO feedback_events (
      feedback_id,request_id,rating,reason_code
    )
    VALUES (?,?,?,?)
    ON CONFLICT(request_id) DO UPDATE SET
      rating=excluded.rating,
      reason_code=excluded.reason_code,
      occurred_at=CURRENT_TIMESTAMP
  `).bind(
    feedbackId,
    requestId,
    rating,
    rating === 'needs_improvement' ? (reason || 'other') : null
  ).run();

  return { ok:true, requestId, rating };
}

async function getUsageSummary(env, days = 30) {
  const db = requireDb(env);
  await ensureOperationalSchema(env);
  const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
  const modifier = '-' + safeDays + ' days';

  const [totals, feedback, providers, tools, sources, daily] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status='answer' THEN 1 ELSE 0 END) AS answered,
        SUM(CASE WHEN status='insufficient' THEN 1 ELSE 0 END) AS insufficient,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN ai_called=1 THEN 1 ELSE 0 END) AS ai_calls,
        ROUND(AVG(latency_ms),0) AS avg_latency_ms,
        MAX(latency_ms) AS max_latency_ms
      FROM usage_events
      WHERE datetime(occurred_at) >= datetime('now',?)
    `).bind(modifier).first(),
    db.prepare(`
      SELECT
        COUNT(*) AS total_feedback,
        SUM(CASE WHEN rating='helpful' THEN 1 ELSE 0 END) AS helpful,
        SUM(CASE WHEN rating='needs_improvement' THEN 1 ELSE 0 END) AS needs_improvement
      FROM feedback_events
      WHERE datetime(occurred_at) >= datetime('now',?)
    `).bind(modifier).first(),
    db.prepare(`
      SELECT provider,COUNT(*) AS count,ROUND(AVG(latency_ms),0) AS avg_latency_ms
      FROM usage_events
      WHERE datetime(occurred_at) >= datetime('now',?)
        AND provider IS NOT NULL
      GROUP BY provider
      ORDER BY count DESC
    `).bind(modifier).all(),
    db.prepare(`
      SELECT tool_id,COUNT(*) AS count
      FROM usage_events
      WHERE datetime(occurred_at) >= datetime('now',?)
      GROUP BY tool_id
      ORDER BY count DESC
    `).bind(modifier).all(),
    db.prepare(`
      SELECT
        d.document_id,d.title,d.source_id,
        COUNT(*) AS use_count
      FROM usage_sources us
      JOIN usage_events ue ON ue.event_id=us.event_id
      JOIN documents d ON d.document_id=us.document_id
      WHERE datetime(ue.occurred_at) >= datetime('now',?)
      GROUP BY d.document_id,d.title,d.source_id
      ORDER BY use_count DESC
      LIMIT 10
    `).bind(modifier).all(),
    db.prepare(`
      SELECT
        date(occurred_at,'+9 hours') AS day,
        COUNT(*) AS requests,
        SUM(CASE WHEN status='answer' THEN 1 ELSE 0 END) AS answered,
        SUM(CASE WHEN status='insufficient' THEN 1 ELSE 0 END) AS insufficient,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors
      FROM usage_events
      WHERE datetime(occurred_at) >= datetime('now',?)
      GROUP BY date(occurred_at,'+9 hours')
      ORDER BY day DESC
      LIMIT 31
    `).bind(modifier).all()
  ]);

  const total = Number(totals?.total_requests || 0);
  const answered = Number(totals?.answered || 0);
  const insufficient = Number(totals?.insufficient || 0);
  const errors = Number(totals?.errors || 0);
  const feedbackTotal = Number(feedback?.total_feedback || 0);
  const helpful = Number(feedback?.helpful || 0);

  return {
    days:safeDays,
    totals:{
      requests:total,
      answered,
      insufficient,
      errors,
      aiCalls:Number(totals?.ai_calls || 0),
      answerRate:total ? answered / total : 0,
      insufficientRate:total ? insufficient / total : 0,
      errorRate:total ? errors / total : 0,
      avgLatencyMs:Number(totals?.avg_latency_ms || 0),
      maxLatencyMs:Number(totals?.max_latency_ms || 0)
    },
    feedback:{
      total:feedbackTotal,
      helpful,
      needsImprovement:Number(feedback?.needs_improvement || 0),
      helpfulRate:feedbackTotal ? helpful / feedbackTotal : 0
    },
    providers:providers?.results || [],
    tools:tools?.results || [],
    topDocuments:sources?.results || [],
    daily:daily?.results || []
  };
}

async function getOperationsSummary(env, hours = 24) {
  const db = requireDb(env);
  await ensureOperationalSchema(env);
  const safeHours = Math.max(1, Math.min(720, Number(hours) || 24));
  const modifier = '-' + safeHours + ' hours';

  const [usage,jobs] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN status='insufficient' THEN 1 ELSE 0 END) AS insufficient,
        ROUND(AVG(latency_ms),0) AS avg_latency_ms,
        MAX(latency_ms) AS max_latency_ms
      FROM usage_events
      WHERE datetime(occurred_at) >= datetime('now',?)
    `).bind(modifier).first(),
    db.prepare(`
      SELECT
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE
          WHEN status IN ('queued','running','waiting_review')
           AND datetime(updated_at) < datetime('now','-24 hours')
          THEN 1 ELSE 0 END
        ) AS stalled
      FROM sync_jobs
    `).first()
  ]);

  const total = Number(usage?.total || 0);
  const errors = Number(usage?.errors || 0);
  const insufficient = Number(usage?.insufficient || 0);
  const errorRate = total ? errors / total : 0;
  const insufficientRate = total ? insufficient / total : 0;
  const avgLatencyMs = Number(usage?.avg_latency_ms || 0);
  const failedJobs = Number(jobs?.failed || 0);
  const stalledJobs = Number(jobs?.stalled || 0);

  const alerts = [];
  if (failedJobs > 0) alerts.push({ level:'error', code:'FAILED_JOBS', message:'失敗した同期ジョブがあります。' });
  if (stalledJobs > 0) alerts.push({ level:'error', code:'STALLED_JOBS', message:'24時間以上停滞した同期ジョブがあります。' });
  if (total >= 10 && errorRate >= 0.10) alerts.push({ level:'error', code:'HIGH_ERROR_RATE', message:'AI処理のエラー率が10%以上です。' });
  if (total >= 10 && avgLatencyMs >= 8000) alerts.push({ level:'warn', code:'HIGH_LATENCY', message:'平均応答時間が8秒以上です。' });
  if (total >= 10 && insufficientRate >= 0.60) alerts.push({ level:'warn', code:'HIGH_INSUFFICIENT_RATE', message:'根拠不足回答が60%以上です。資料拡充を検討してください。' });

  return {
    hours:safeHours,
    health:alerts.some(a=>a.level==='error') ? 'error' : (alerts.length ? 'warn' : 'ok'),
    requests:total,
    errors,
    errorRate,
    insufficient,
    insufficientRate,
    avgLatencyMs,
    maxLatencyMs:Number(usage?.max_latency_ms || 0),
    failedJobs,
    stalledJobs,
    alerts
  };
}

export {
  ensureOperationalSchema,
  recordUsageEvent,
  submitFeedback,
  getUsageSummary,
  getOperationsSummary
};
