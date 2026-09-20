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

  const [totals, feedback, feedbackReasons, providers, tools, sources, daily] = await Promise.all([
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
      SELECT reason_code,COUNT(*) AS count
      FROM feedback_events
      WHERE datetime(occurred_at) >= datetime('now',?)
        AND rating='needs_improvement'
      GROUP BY reason_code
      ORDER BY count DESC
    `).bind(modifier).all(),
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
    feedbackReasons:feedbackReasons?.results || [],
    providers:providers?.results || [],
    tools:tools?.results || [],
    topDocuments:sources?.results || [],
    daily:daily?.results || []
  };
}

async function getImprovementCandidates(env, days = 30) {
  const db = requireDb(env);
  await ensureOperationalSchema(env);

  const safeDays = Math.max(7, Math.min(180, Number(days) || 30));
  const modifier = '-' + safeDays + ' days';

  const [documentMetrics, expiringRows, statusRows, faqTotals] = await Promise.all([
    db.prepare(`
      SELECT
        d.document_id,
        d.source_id,
        d.title,
        d.category_id,
        c.name AS category_name,
        d.source_type,
        d.valid_until,
        d.last_synced_at,
        d.created_at,
        d.updated_at,
        COUNT(DISTINCT ue.event_id) AS use_count,
        COUNT(DISTINCT CASE WHEN fe.rating='helpful' THEN fe.request_id END) AS helpful_count,
        COUNT(DISTINCT CASE WHEN fe.rating='needs_improvement' THEN fe.request_id END) AS negative_count,
        COUNT(DISTINCT CASE WHEN fe.reason_code='wrong_source' THEN fe.request_id END) AS wrong_source_count,
        COUNT(DISTINCT CASE WHEN fe.reason_code='answer_incomplete' THEN fe.request_id END) AS incomplete_count,
        COUNT(DISTINCT CASE WHEN fe.reason_code='hard_to_understand' THEN fe.request_id END) AS hard_to_understand_count,
        COUNT(DISTINCT CASE WHEN fe.reason_code='outdated' THEN fe.request_id END) AS outdated_count,
        MAX(ue.occurred_at) AS last_used_at
      FROM documents d
      LEFT JOIN categories c ON c.category_id=d.category_id
      LEFT JOIN usage_sources us ON us.document_id=d.document_id
      LEFT JOIN usage_events ue
        ON ue.event_id=us.event_id
       AND datetime(ue.occurred_at) >= datetime('now',?)
      LEFT JOIN feedback_events fe
        ON fe.request_id=ue.request_id
       AND datetime(fe.occurred_at) >= datetime('now',?)
      WHERE d.is_current=1
        AND d.status='active'
        AND d.approval_status='approved'
        AND d.deleted_at IS NULL
        AND d.source_id NOT LIKE 'step5-test-%'
        AND (d.valid_from IS NULL OR TRIM(d.valid_from)='' OR date(d.valid_from) <= date('now','+9 hours'))
        AND (d.valid_until IS NULL OR TRIM(d.valid_until)='' OR date(d.valid_until) >= date('now','+9 hours'))
      GROUP BY
        d.document_id,d.source_id,d.title,d.category_id,c.name,d.source_type,
        d.valid_until,d.last_synced_at,d.created_at,d.updated_at
      ORDER BY d.title
    `).bind(modifier,modifier).all(),

    db.prepare(`
      SELECT
        d.document_id,d.source_id,d.title,d.valid_until,
        d.category_id,c.name AS category_name
      FROM documents d
      LEFT JOIN categories c ON c.category_id=d.category_id
      WHERE d.is_current=1
        AND d.status='active'
        AND d.approval_status='approved'
        AND d.deleted_at IS NULL
        AND d.source_id NOT LIKE 'step5-test-%'
        AND d.valid_until IS NOT NULL
        AND TRIM(d.valid_until)<>''
        AND date(d.valid_until) BETWEEN
          date('now','+9 hours')
          AND date('now','+9 hours','+30 days')
      ORDER BY date(d.valid_until),d.title
      LIMIT 100
    `).all(),

    db.prepare(`
      SELECT
        d.document_id,d.source_id,d.title,d.status,d.category_id,
        c.name AS category_name,d.updated_at
      FROM documents d
      LEFT JOIN categories c ON c.category_id=d.category_id
      WHERE d.is_current=1
        AND d.deleted_at IS NULL
        AND d.source_id NOT LIKE 'step5-test-%'
        AND d.status IN ('error','source_missing','expired')
      ORDER BY
        CASE d.status
          WHEN 'error' THEN 1
          WHEN 'source_missing' THEN 2
          ELSE 3
        END,
        d.updated_at DESC
      LIMIT 100
    `).all(),

    db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='insufficient' THEN 1 ELSE 0 END) AS insufficient
      FROM usage_events
      WHERE tool_id='faq'
        AND datetime(occurred_at) >= datetime('now',?)
    `).bind(modifier).first()
  ]);

  const docs = (documentMetrics?.results || []).map(row => {
    const useCount = Number(row.use_count || 0);
    const helpfulCount = Number(row.helpful_count || 0);
    const negativeCount = Number(row.negative_count || 0);
    const feedbackCount = helpfulCount + negativeCount;
    return {
      documentId:String(row.document_id || ''),
      sourceId:String(row.source_id || ''),
      title:String(row.title || ''),
      categoryId:String(row.category_id || ''),
      categoryName:String(row.category_name || ''),
      sourceType:String(row.source_type || ''),
      validUntil:String(row.valid_until || ''),
      lastSyncedAt:String(row.last_synced_at || ''),
      createdAt:String(row.created_at || ''),
      updatedAt:String(row.updated_at || ''),
      lastUsedAt:String(row.last_used_at || ''),
      useCount,
      helpfulCount,
      negativeCount,
      feedbackCount,
      negativeRate:feedbackCount ? negativeCount / feedbackCount : 0,
      reasons:{
        wrongSource:Number(row.wrong_source_count || 0),
        incomplete:Number(row.incomplete_count || 0),
        hardToUnderstand:Number(row.hard_to_understand_count || 0),
        outdated:Number(row.outdated_count || 0)
      }
    };
  });

  const periodStart = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const unusedDocuments = docs.filter(doc => {
    const created = Date.parse(doc.createdAt || '');
    return doc.useCount === 0 && Number.isFinite(created) && created <= periodStart;
  });

  const qualityAttention = docs
    .filter(doc => doc.negativeCount > 0)
    .map(doc => ({
      ...doc,
      level:
        doc.reasons.wrongSource > 0 ||
        doc.reasons.outdated > 0 ||
        doc.negativeCount >= 2
          ? 'action'
          : 'watch'
    }))
    .sort((a,b) =>
      Number(b.reasons.wrongSource > 0) - Number(a.reasons.wrongSource > 0) ||
      b.negativeCount - a.negativeCount ||
      b.useCount - a.useCount
    );

  const expiringSoon = (expiringRows?.results || []).map(row => ({
    documentId:String(row.document_id || ''),
    sourceId:String(row.source_id || ''),
    title:String(row.title || ''),
    validUntil:String(row.valid_until || ''),
    categoryId:String(row.category_id || ''),
    categoryName:String(row.category_name || '')
  }));

  const statusIssues = (statusRows?.results || []).map(row => ({
    documentId:String(row.document_id || ''),
    sourceId:String(row.source_id || ''),
    title:String(row.title || ''),
    status:String(row.status || ''),
    categoryId:String(row.category_id || ''),
    categoryName:String(row.category_name || ''),
    updatedAt:String(row.updated_at || '')
  }));

  const faqRequests = Number(faqTotals?.total || 0);
  const faqInsufficient = Number(faqTotals?.insufficient || 0);
  const faqInsufficientRate = faqRequests ? faqInsufficient / faqRequests : 0;

  const recommendations = [];

  for (const issue of statusIssues) {
    const message =
      issue.status === 'error'
        ? '処理エラーの現行資料です。同期ジョブとDrive原本を確認してください。'
        : issue.status === 'source_missing'
          ? 'Drive原本を確認できない資料です。移動・削除・再登録を確認してください。'
          : '有効期限切れの資料です。新版が必要か確認してください。';

    recommendations.push({
      id:'status:' + issue.documentId,
      type:'document_status',
      level:issue.status === 'expired' ? 'watch' : 'action',
      title:issue.title,
      message,
      documentId:issue.documentId,
      sourceId:issue.sourceId,
      categoryName:issue.categoryName
    });
  }

  for (const doc of qualityAttention) {
    const reasonParts = [];
    if (doc.reasons.wrongSource) reasonParts.push('根拠違い ' + doc.reasons.wrongSource + '件');
    if (doc.reasons.outdated) reasonParts.push('古い情報 ' + doc.reasons.outdated + '件');
    if (doc.reasons.incomplete) reasonParts.push('回答不足 ' + doc.reasons.incomplete + '件');
    if (doc.reasons.hardToUnderstand) reasonParts.push('わかりにくい ' + doc.reasons.hardToUnderstand + '件');

    recommendations.push({
      id:'quality:' + doc.documentId,
      type:'quality_feedback',
      level:doc.level,
      title:doc.title,
      message:
        '改善評価 ' + doc.negativeCount + '件。' +
        (reasonParts.length ? reasonParts.join('、') + '。' : '') +
        '資料本文・版・チャンク構造を確認してください。',
      documentId:doc.documentId,
      sourceId:doc.sourceId,
      categoryName:doc.categoryName
    });
  }

  for (const doc of expiringSoon) {
    recommendations.push({
      id:'expiry:' + doc.documentId,
      type:'expiring_soon',
      level:'watch',
      title:doc.title,
      message:'有効期限が ' + doc.validUntil + ' です。新版の有無を確認してください。',
      documentId:doc.documentId,
      sourceId:doc.sourceId,
      categoryName:doc.categoryName
    });
  }

  for (const doc of unusedDocuments) {
    recommendations.push({
      id:'unused:' + doc.documentId,
      type:'unused_document',
      level:'info',
      title:doc.title,
      message:
        safeDays + '日間、FAQ回答の根拠として参照されていません。' +
        '必要性・検索しやすい表現・対象範囲を確認する候補です。',
      documentId:doc.documentId,
      sourceId:doc.sourceId,
      categoryName:doc.categoryName
    });
  }

  if (faqRequests >= 10 && faqInsufficientRate >= 0.40) {
    recommendations.unshift({
      id:'global:insufficient',
      type:'global_coverage',
      level:faqInsufficientRate >= 0.60 ? 'action' : 'watch',
      title:'FAQ全体の資料カバー率',
      message:
        safeDays + '日間の根拠不足率が ' +
        (faqInsufficientRate * 100).toFixed(1) +
        '% です。Evidence Gateは緩めず、承認資料の不足や資料構造を確認してください。',
      documentId:'',
      sourceId:'',
      categoryName:''
    });
  }

  const levelOrder = { action:0, watch:1, info:2 };
  recommendations.sort((a,b) =>
    (levelOrder[a.level] ?? 9) - (levelOrder[b.level] ?? 9) ||
    String(a.title || '').localeCompare(String(b.title || ''),'ja')
  );

  return {
    days:safeDays,
    privacy:{
      storesQuestionText:false,
      storesAnswerText:false,
      storesUserEmail:false,
      storesIpAddress:false
    },
    summary:{
      activeDocuments:docs.length,
      documentsUsed:docs.filter(doc => doc.useCount > 0).length,
      unusedDocuments:unusedDocuments.length,
      qualityAttention:qualityAttention.length,
      expiringSoon:expiringSoon.length,
      statusIssues:statusIssues.length,
      faqRequests,
      faqInsufficient,
      faqInsufficientRate,
      actionCount:recommendations.filter(item => item.level === 'action').length,
      watchCount:recommendations.filter(item => item.level === 'watch').length,
      infoCount:recommendations.filter(item => item.level === 'info').length
    },
    qualityAttention,
    expiringSoon,
    unusedDocuments,
    statusIssues,
    recommendations
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
  getImprovementCandidates,
  getOperationsSummary
};
