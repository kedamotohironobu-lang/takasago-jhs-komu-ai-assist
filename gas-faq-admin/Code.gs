const DEFAULT_WORKER_BASE_URL = 'https://takasago-jhs-komu-ai-assist.kedamoto-hironobu.workers.dev';

const PROP = {
  WORKER_BASE_URL: 'WORKER_BASE_URL',
  FAQ_ADMIN_TOKEN: 'FAQ_ADMIN_TOKEN',
  FAQ_FOLDER_ID: 'FAQ_FOLDER_ID'
};

const MIME = {
  GOOGLE_DOC: 'application/vnd.google-apps.document',
  GOOGLE_SHEET: 'application/vnd.google-apps.spreadsheet',
  GOOGLE_SLIDES: 'application/vnd.google-apps.presentation',
  TEXT: 'text/plain',
  CSV: 'text/csv',
  JSON: 'application/json',
  HTML: 'text/html',
  MARKDOWN: 'text/markdown',
  PDF: 'application/pdf',
  WORD: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  WORD_LEGACY: 'application/msword',
  EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  EXCEL_LEGACY: 'application/vnd.ms-excel',
  POWERPOINT: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  POWERPOINT_LEGACY: 'application/vnd.ms-powerpoint'
};

const MAX_TEXT_CHARS = 100000;
const MAX_PREVIEW_CHARS = 6000;

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('校内FAQ 資料登録ツール');
}

function getAppState() {
  const props = PropertiesService.getScriptProperties();
  const workerBaseUrl = normalizeBaseUrl_(props.getProperty(PROP.WORKER_BASE_URL) || DEFAULT_WORKER_BASE_URL);
  const folderId = String(props.getProperty(PROP.FAQ_FOLDER_ID) || '').trim();
  const hasAdminToken = Boolean(String(props.getProperty(PROP.FAQ_ADMIN_TOKEN) || '').trim());

  let folderName = '';
  let folderError = '';
  if (folderId) {
    try {
      folderName = DriveApp.getFolderById(folderId).getName();
    } catch (e) {
      folderError = '指定されたGoogle Driveフォルダを開けません。';
    }
  }

  let faq = null;
  let faqError = '';
  try {
    faq = workerRequest_('/health/faq', 'get', null, false);
  } catch (e) {
    faqError = String(e.message || e);
  }

  return {
    workerBaseUrl,
    folderId,
    folderName,
    folderError,
    hasAdminToken,
    faq,
    faqError
  };
}

function saveFolderId(folderId) {
  const value = String(folderId || '').trim();
  if (!value) throw new Error('Google DriveフォルダIDを入力してください。');

  const folder = DriveApp.getFolderById(value);
  PropertiesService.getScriptProperties().setProperty(PROP.FAQ_FOLDER_ID, value);

  return {
    ok: true,
    folderId: value,
    folderName: folder.getName()
  };
}

function getDriveFiles() {
  const folder = getFaqFolder_();
  const files = folder.getFiles();
  const rows = [];

  while (files.hasNext() && rows.length < 200) {
    const file = files.next();
    const mimeType = file.getMimeType();
    const support = supportInfo_(mimeType);
    rows.push({
      id: file.getId(),
      name: file.getName(),
      mimeType,
      kind: support.label,
      supported: support.supported,
      note: support.note,
      requiresOcrConfirmation: Boolean(support.requiresOcrConfirmation),
      updatedAt: formatDateTime_(file.getLastUpdated()),
      updatedAtIso: file.getLastUpdated().toISOString(),
      size: Number(file.getSize() || 0),
      url: file.getUrl()
    });
  }

  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt), 'ja'));
  return rows;
}

function getFaqFolder_() {
  const folderId = String(PropertiesService.getScriptProperties().getProperty(PROP.FAQ_FOLDER_ID) || '').trim();
  if (!folderId) throw new Error('FAQ_FOLDER_ID が未設定です。管理画面でGoogle DriveフォルダIDを設定してください。');
  return DriveApp.getFolderById(folderId);
}

function supportInfo_(mimeType) {
  const map = {};
  map[MIME.GOOGLE_DOC] = { supported: true, label: 'Googleドキュメント', note: '' };
  map[MIME.GOOGLE_SHEET] = { supported: true, label: 'Googleスプレッドシート', note: '' };
  map[MIME.GOOGLE_SLIDES] = { supported: true, label: 'Googleスライド', note: '' };
  map[MIME.TEXT] = { supported: true, label: 'テキスト', note: '' };
  map[MIME.CSV] = { supported: true, label: 'CSV', note: '' };
  map[MIME.JSON] = { supported: true, label: 'JSON', note: '' };
  map[MIME.HTML] = { supported: true, label: 'HTML', note: '' };
  map[MIME.MARKDOWN] = { supported: true, label: 'Markdown', note: '' };
  map[MIME.WORD] = { supported: true, label: 'Word', note: '一時的にGoogleドキュメントへ変換して本文を抽出します。' };
  map[MIME.WORD_LEGACY] = { supported: true, label: 'Word', note: '一時的にGoogleドキュメントへ変換して本文を抽出します。' };
  map[MIME.EXCEL] = { supported: true, label: 'Excel', note: '一時的にGoogleスプレッドシートへ変換してシート単位で抽出します。' };
  map[MIME.EXCEL_LEGACY] = { supported: true, label: 'Excel', note: '一時的にGoogleスプレッドシートへ変換してシート単位で抽出します。' };
  map[MIME.POWERPOINT] = { supported: true, label: 'PowerPoint', note: '一時的にGoogleスライドへ変換してスライド単位で抽出します。' };
  map[MIME.POWERPOINT_LEGACY] = { supported: true, label: 'PowerPoint', note: '一時的にGoogleスライドへ変換してスライド単位で抽出します。' };
  map[MIME.PDF] = {
    supported: true,
    label: 'PDF',
    note: 'Google DriveのPDF→Googleドキュメント変換/OCRを使用します。プレビュー前に管理者確認が必要です。',
    requiresOcrConfirmation: true
  };

  return map[mimeType] || {
    supported: false,
    label: mimeType || '不明',
    note: 'このファイル形式は現在の直接抽出対象外です。'
  };
}

function workerRequest_(path, method, body, adminRequired) {
  const props = PropertiesService.getScriptProperties();
  const base = normalizeBaseUrl_(props.getProperty(PROP.WORKER_BASE_URL) || DEFAULT_WORKER_BASE_URL);
  const token = String(props.getProperty(PROP.FAQ_ADMIN_TOKEN) || '').trim();

  if (adminRequired && !token) {
    throw new Error('FAQ_ADMIN_TOKEN がScript Propertiesに設定されていません。');
  }

  const headers = {};
  if (adminRequired) headers['X-FAQ-Admin-Token'] = token;

  const options = {
    method: method || 'get',
    muteHttpExceptions: true,
    headers
  };

  if (body !== null && body !== undefined) {
    options.contentType = 'application/json; charset=utf-8';
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch(base + path, options);
  const status = response.getResponseCode();
  const text = response.getContentText();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error('WorkerからJSON以外の応答が返りました。HTTP ' + status);
  }

  if (status < 200 || status >= 300 || data.ok === false) {
    const message = data && data.error && data.error.message
      ? data.error.message
      : 'Worker APIエラー HTTP ' + status;
    throw new Error(message);
  }

  return data;
}

function normalizeBaseUrl_(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function makeSourceId_(fileId) {
  return ('gdrive-' + String(fileId || ''))
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 80);
}

function clean_(value, max) {
  return String(value || '').trim().slice(0, max || 200);
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
}

function formatDateTime_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
}


/**
 * STEP5-3: Cloudflare Vectorize Index を1回だけ作成します。
 * 必須Script Properties:
 * - CLOUDFLARE_ACCOUNT_ID
 * - CLOUDFLARE_VECTORIZE_TOKEN
 */
function createVectorizeIndex() {
  const props = PropertiesService.getScriptProperties();
  const accountId = String(props.getProperty('CLOUDFLARE_ACCOUNT_ID') || '').trim();
  const token = String(props.getProperty('CLOUDFLARE_VECTORIZE_TOKEN') || '').trim();

  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID が設定されていません。');
  }
  if (!token) {
    throw new Error('CLOUDFLARE_VECTORIZE_TOKEN が設定されていません。');
  }

  const indexName = 'takasago-jhs-komu-rag-v1';
  const url =
    'https://api.cloudflare.com/client/v4/accounts/' +
    encodeURIComponent(accountId) +
    '/vectorize/v2/indexes';

  const payload = {
    name: indexName,
    description: '高砂中学校 校務AIアシスト 校内FAQ RAG',
    config: {
      dimensions: 384,
      metric: 'cosine'
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  console.log('HTTP status: ' + status);
  console.log(body);

  let data = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch (e) {
    throw new Error('CloudflareからJSON以外の応答が返りました。HTTP ' + status);
  }

  if (status < 200 || status >= 300 || data.success === false) {
    const errors = Array.isArray(data.errors)
      ? data.errors.map(function (x) { return x.message || JSON.stringify(x); }).join(' / ')
      : '';
    throw new Error(
      'Vectorize Indexの作成に失敗しました。HTTP ' +
      status +
      (errors ? '\n' + errors : '\n' + body)
    );
  }

  console.log('Vectorize Index作成成功');
  console.log('Index: ' + indexName);
  console.log('Dimensions: 384');
  console.log('Metric: cosine');

  return data;
}


/**
 * STEP5-3: Worker -> Gemini Embedding -> Vectorize の接続試験。
 * FAQ_ADMIN_TOKEN がScript Propertiesに必要です。
 */
function testVectorizeUpsert() {
  const result = workerRequest_('/admin/rag/vector-test', 'post', { action: 'upsert' }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Vectorizeのupsertは非同期反映のため、testVectorizeUpsert()実行後に
 * 数秒待ってからこの関数を実行します。
 */
function testVectorizeQuery() {
  const result = workerRequest_('/admin/rag/vector-test', 'post', { action: 'query' }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}


/**
 * STEP5-3: Vectorizeへ登録した接続確認用ベクトルをIDで直接確認します。
 */
function testVectorizeGet() {
  const result = workerRequest_('/admin/rag/vector-test', 'post', { action: 'get' }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * STEP5-3: 接続確認用ベクトルを削除します。
 */
function cleanupVectorizeTest() {
  const result = workerRequest_('/admin/rag/vector-test', 'post', { action: 'delete' }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}


const STEP5_TEST_DOCUMENT_PROPERTY = 'STEP5_TEST_DOCUMENT_ID';

/**
 * STEP5-4: D1のindexと初期カテゴリを冪等に整備します。
 */
function ensureRagSchemaStep5() {
  const result = workerRequest_('/admin/rag/schema-ensure', 'post', {}, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * STEP5-4: 現在のRAG容量見積りを確認します。
 */
function getRagCapacityStep5() {
  const result = workerRequest_('/admin/rag/capacity', 'get', null, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * STEP5-4: 架空の資料をD1へステージング登録します。
 * 実際の校内規則ではありません。
 */
function stageRagSyntheticStep5() {
  const body = {
    sourceId: 'step5-test-pipeline-v1',
    sourceType: 'upload',
    fileName: 'STEP5-4_RAG動作確認用資料.txt',
    title: 'STEP5-4 RAG動作確認用資料',
    mimeType: 'text/plain',
    categoryId: 'cat-other',
    ownerDepartment: 'STEP5動作確認',
    versionLabel: 'test-v1',
    approved: true,
    sections: [
      {
        headingPath: '動作確認 > 備品A',
        text: [
          'これはSTEP5-4のRAGパイプライン確認専用の架空資料です。実際の校内規則ではありません。',
          'テスト備品Aの確認日は金曜日です。確認後はテスト記録欄に「確認済み」と記載します。',
          'テスト備品Aに不具合がある場合は、架空のテスト担当へ確認するものとします。'
        ].join('\n\n')
      },
      {
        headingPath: '動作確認 > 会議B',
        text: [
          'これは検索精度確認のための架空情報です。',
          'テスト会議Bの資料は前日までに確認する設定です。',
          'この記載はSTEP5の接続確認だけに使用し、本番の校内ルールとして利用しません。'
        ].join('\n\n')
      }
    ]
  };

  const result = workerRequest_('/admin/rag/stage', 'post', body, true);
  const documentId = result && result.result && result.result.documentId;
  if (documentId) {
    PropertiesService.getScriptProperties().setProperty(STEP5_TEST_DOCUMENT_PROPERTY, documentId);
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function getStep5TestDocumentId_() {
  const id = String(
    PropertiesService.getScriptProperties().getProperty(STEP5_TEST_DOCUMENT_PROPERTY) || ''
  ).trim();
  if (!id) {
    throw new Error('STEP5テスト用documentIdがありません。先に stageRagSyntheticStep5() を実行してください。');
  }
  return id;
}

/**
 * STEP5-4: テスト資料の未処理チャンクを最大20件ずつVectorizeへ登録します。
 */
function indexRagSyntheticStep5() {
  const documentId = getStep5TestDocumentId_();
  const result = workerRequest_('/admin/rag/index-next', 'post', {
    documentId: documentId,
    limit: 20
  }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * STEP5-4: D1上の処理状態を確認します。
 */
function statusRagSyntheticStep5() {
  const documentId = getStep5TestDocumentId_();
  const result = workerRequest_(
    '/admin/rag/document-status?documentId=' + encodeURIComponent(documentId),
    'get',
    null,
    true
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * STEP5-4: Vectorize反映確認後、D1+FTS5の本番検索対象へ切り替えます。
 * VECTOR_NOT_READYの場合は数秒待って再実行してください。
 */
function finalizeRagSyntheticStep5() {
  const documentId = getStep5TestDocumentId_();
  const result = workerRequest_('/admin/rag/finalize', 'post', {
    documentId: documentId
  }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * STEP5-4: 架空のテスト資料だけをD1/Vectorize/FTS5から削除します。
 */
function cleanupRagSyntheticStep5() {
  const documentId = getStep5TestDocumentId_();
  const result = workerRequest_('/admin/rag/test-cleanup', 'post', {
    documentId: documentId
  }, true);
  PropertiesService.getScriptProperties().deleteProperty(STEP5_TEST_DOCUMENT_PROPERTY);
  console.log(JSON.stringify(result, null, 2));
  return result;
}


/**
 * STEP5-5: Vectorize + FTS5 + RRF のHybrid Retrievalを確認します。
 * 先にSTEP5の架空資料を stage -> index -> finalize しておいてください。
 */
function testHybridRetrievalStep5() {
  const result = workerRequest_('/admin/rag/retrieval-test', 'post', {
    query: 'テスト備品Aは何曜日に確認しますか？',
    evidenceLimit: 4
  }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * STEP5-5: 別表現でも意味検索できるか確認します。
 */
function testHybridRetrievalParaphraseStep5() {
  const result = workerRequest_('/admin/rag/retrieval-test', 'post', {
    query: '備品Aのチェックをする日はいつですか？',
    evidenceLimit: 4
  }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}


/**
 * STEP5-5: 架空資料を再登録し、Hybrid Retrievalまで一括確認します。
 * 失敗時は途中状態を残すため、cleanupは自動実行しません。
 */
function runHybridRetrievalSyntheticStep5() {
  const stage = stageRagSyntheticStep5();
  const index = indexRagSyntheticStep5();

  let finalized = null;
  let lastError = null;

  for (let i = 0; i < 4; i++) {
    Utilities.sleep(6000);
    try {
      finalized = finalizeRagSyntheticStep5();
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      const message = String(e && e.message ? e.message : e);
      if (message.indexOf('Vectorizeへの反映待ち') === -1) {
        throw e;
      }
    }
  }

  if (!finalized) {
    throw lastError || new Error(
      'Vectorizeへの反映待ちです。少し待って finalizeRagSyntheticStep5() を実行してください。'
    );
  }

  const retrieval = waitHybridRetrievalVectorStep5_();

  const vectorMatches =
    retrieval &&
    retrieval.result &&
    retrieval.result.diagnostics &&
    Array.isArray(retrieval.result.diagnostics.vectorMatches)
      ? retrieval.result.diagnostics.vectorMatches
      : [];

  if (!vectorMatches.length) {
    throw new Error(
      'FTS5検索は成功しましたが、Vectorizeの意味検索がまだ反映されていません。少し待って testHybridRetrievalStep5() を再実行してください。'
    );
  }

  const result = {
    ok: true,
    stage: stage,
    index: index,
    finalize: finalized,
    retrieval: retrieval
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}


function waitHybridRetrievalVectorStep5_() {
  let last = null;

  for (let i = 0; i < 6; i++) {
    const result = testHybridRetrievalStep5();
    last = result;

    const matches =
      result &&
      result.result &&
      result.result.diagnostics &&
      Array.isArray(result.result.diagnostics.vectorMatches)
        ? result.result.diagnostics.vectorMatches
        : [];

    if (matches.length > 0) {
      return result;
    }

    Utilities.sleep(5000);
  }

  return last;
}


/**
 * STEP5-5: 無関係質問で誤ヒットしないか確認します。
 * STEP5-6のevidence threshold設計用。
 */
function testHybridRetrievalNegativeStep5() {
  const result = workerRequest_('/admin/rag/retrieval-test', 'post', {
    query: '修学旅行の集合時間は何時ですか？',
    evidenceLimit: 4
  }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}


/**
 * STEP5-6: 十分な根拠がある質問ではAI回答することを確認します。
 */
function testRagAnswerPositiveStep5() {
  const result = workerRequest_('/admin/rag/answer-test', 'post', {
    query: 'テスト備品Aは何曜日に確認しますか？'
  }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * STEP5-6: 言い換え質問でも十分な根拠があればAI回答することを確認します。
 */
function testRagAnswerParaphraseStep5() {
  const result = workerRequest_('/admin/rag/answer-test', 'post', {
    query: '備品Aのチェックをする日はいつですか？'
  }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * STEP5-6: 無関係質問ではAIを呼ばず insufficient になることを確認します。
 */
function testRagAnswerNegativeStep5() {
  const result = workerRequest_('/admin/rag/answer-test', 'post', {
    query: '修学旅行の集合時間は何時ですか？'
  }, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * STEP5-6: 3ケースを連続確認します。
 * 期待:
 * - positive: status=answer, aiCalled=true
 * - paraphrase: status=answer, aiCalled=true
 * - negative: status=insufficient, aiCalled=false
 */
function runRagAnswerGateStep5() {
  const positive = testRagAnswerPositiveStep5();
  const paraphrase = testRagAnswerParaphraseStep5();
  const negative = testRagAnswerNegativeStep5();

  const p = positive && positive.result ? positive.result : {};
  const q = paraphrase && paraphrase.result ? paraphrase.result : {};
  const n = negative && negative.result ? negative.result : {};

  const checks = {
    positiveAnswer: p.status === 'answer' && p.aiCalled === true,
    paraphraseAnswer: q.status === 'answer' && q.aiCalled === true,
    negativeBlocked: n.status === 'insufficient' && n.aiCalled === false
  };

  const result = {
    ok: checks.positiveAnswer && checks.paraphraseAnswer && checks.negativeBlocked,
    checks: checks,
    positive: positive,
    paraphrase: paraphrase,
    negative: negative
  };

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    throw new Error(
      'STEP5-6の期待結果と一致しない項目があります。実行ログを確認してください。'
    );
  }

  return result;
}


/* =========================================================
 * STEP5-8: Google Drive -> D1 -> Vectorize -> FTS5
 * ========================================================= */

const STEP5_LAST_DOCUMENT_PROPERTY = 'STEP5_LAST_DOCUMENT_ID';
const STEP5_MAX_INDEX_BATCHES_PER_RUN = 8;

function checkDriveConversionStep5() {
  try {
    const about = Drive.About.get({ fields: 'importFormats' });
    const formats = about && about.importFormats ? about.importFormats : {};

    return {
      ok: true,
      configured: true,
      word: Boolean(
        formats[MIME.WORD] &&
        formats[MIME.WORD].indexOf(MIME.GOOGLE_DOC) >= 0
      ),
      excel: Boolean(
        formats[MIME.EXCEL] &&
        formats[MIME.EXCEL].indexOf(MIME.GOOGLE_SHEET) >= 0
      ),
      powerpoint: Boolean(
        formats[MIME.POWERPOINT] &&
        formats[MIME.POWERPOINT].indexOf(MIME.GOOGLE_SLIDES) >= 0
      ),
      pdf: Boolean(
        formats[MIME.PDF] &&
        formats[MIME.PDF].indexOf(MIME.GOOGLE_DOC) >= 0
      )
    };
  } catch (e) {
    return {
      ok: false,
      configured: false,
      error: String(e && e.message ? e.message : e)
    };
  }
}

function getRagAdminStateStep5() {
  const props = PropertiesService.getScriptProperties();
  const folderId = String(props.getProperty(PROP.FAQ_FOLDER_ID) || '').trim();
  let folderName = '';
  let folderError = '';

  if (folderId) {
    try {
      folderName = DriveApp.getFolderById(folderId).getName();
    } catch (e) {
      folderError = '指定されたGoogle Driveフォルダを開けません。';
    }
  }

  const health = {};
  const endpoints = {
    ragDb: '/health/rag-db',
    ragVector: '/health/rag-vector',
    ragGate: '/health/rag-gate',
    ragDashboard: '/health/rag-dashboard'
  };

  Object.keys(endpoints).forEach(function (key) {
    try {
      health[key] = workerRequest_(endpoints[key], 'get', null, false);
    } catch (e) {
      health[key] = { ok: false, error: String(e.message || e) };
    }
  });

  return {
    ok: true,
    folderId: folderId,
    folderName: folderName,
    folderError: folderError,
    hasAdminToken: Boolean(String(props.getProperty(PROP.FAQ_ADMIN_TOKEN) || '').trim()),
    driveConversion: checkDriveConversionStep5(),
    health: health
  };
}

function getRagCategoriesStep5() {
  const response = workerRequest_('/admin/rag/categories', 'get', null, true);
  return response && response.result && response.result.categories
    ? response.result.categories
    : [];
}

function listRagDocumentsStep5() {
  const response = workerRequest_('/admin/rag/documents', 'get', null, true);
  return response && response.result && response.result.documents
    ? response.result.documents
    : [];
}

function getRagDocumentStatusStep5(documentId) {
  const id = String(documentId || '').trim();
  if (!id) throw new Error('documentId がありません。');
  return workerRequest_(
    '/admin/rag/document-status?documentId=' + encodeURIComponent(id),
    'get',
    null,
    true
  );
}

function scanDriveSyncStep5() {
  const folder = getFaqFolder_();
  const files = folder.getFiles();
  const driveFiles = [];

  while (files.hasNext() && driveFiles.length < 500) {
    const file = files.next();
    const support = supportInfo_(file.getMimeType());
    driveFiles.push({
      fileId: file.getId(),
      sourceId: makeSourceId_(file.getId()),
      name: file.getName(),
      mimeType: file.getMimeType(),
      kind: support.label,
      supported: Boolean(support.supported),
      note: support.note || '',
      updatedAt: formatDateTime_(file.getLastUpdated()),
      updatedAtIso: file.getLastUpdated().toISOString(),
      updatedAtMs: file.getLastUpdated().getTime(),
      size: Number(file.getSize() || 0)
    });
  }

  const documents = listRagDocumentsStep5();
  const currentDriveDocs = documents.filter(function (doc) {
    return doc && doc.isCurrent === true && doc.sourceType === 'drive';
  });

  const byDriveFileId = {};
  const bySourceId = {};
  currentDriveDocs.forEach(function (doc) {
    if (doc.driveFileId) byDriveFileId[doc.driveFileId] = doc;
    if (doc.sourceId) bySourceId[doc.sourceId] = doc;
  });

  const seenDriveIds = {};
  const items = driveFiles.map(function (file) {
    seenDriveIds[file.fileId] = true;
    const doc = byDriveFileId[file.fileId] || bySourceId[file.sourceId] || null;

    let syncStatus = 'new';
    let reason = 'D1に現行版がありません。';

    if (doc) {
      const registeredMs = doc.sourceModifiedAt
        ? new Date(doc.sourceModifiedAt).getTime()
        : 0;

      if (doc.status === 'source_missing') {
        syncStatus = 'changed';
        reason = 'Drive原本が再確認できました。再登録が必要です。';
      } else if (!registeredMs || file.updatedAtMs > registeredMs + 1000) {
        syncStatus = 'changed';
        reason = 'Drive原本がD1現行版より新しく更新されています。';
      } else {
        syncStatus = 'unchanged';
        reason = '更新はありません。';
      }
    }

    return {
      fileId: file.fileId,
      sourceId: file.sourceId,
      name: file.name,
      mimeType: file.mimeType,
      kind: file.kind,
      supported: file.supported,
      note: file.note,
      updatedAt: file.updatedAt,
      updatedAtIso: file.updatedAtIso,
      size: file.size,
      syncStatus: syncStatus,
      reason: reason,
      currentDocumentId: doc ? doc.documentId : '',
      currentRevisionNo: doc ? Number(doc.revisionNo || 0) : 0,
      currentVersionLabel: doc ? doc.versionLabel || '' : '',
      currentStatus: doc ? doc.status || '' : '',
      categoryId: doc ? doc.categoryId || 'cat-other' : 'cat-other',
      ownerDepartment: doc ? doc.ownerDepartment || '' : '',
      validFrom: doc ? doc.validFrom || '' : '',
      validUntil: doc ? doc.validUntil || '' : ''
    };
  });

  const missing = currentDriveDocs
    .filter(function (doc) {
      return doc.driveFileId &&
        !seenDriveIds[doc.driveFileId] &&
        doc.status !== 'source_missing';
    })
    .map(function (doc) {
      return {
        sourceId: doc.sourceId,
        driveFileId: doc.driveFileId,
        title: doc.title || doc.fileName || '',
        revisionNo: Number(doc.revisionNo || 0),
        status: doc.status || '',
        lastSyncedAt: doc.lastSyncedAt || '',
        actionRequired: true
      };
    });

  items.sort(function (a, b) {
    const order = { changed: 0, new: 1, unchanged: 2 };
    const ao = order[a.syncStatus] == null ? 9 : order[a.syncStatus];
    const bo = order[b.syncStatus] == null ? 9 : order[b.syncStatus];
    if (ao !== bo) return ao - bo;
    return String(a.name).localeCompare(String(b.name), 'ja');
  });

  return {
    ok: true,
    folderName: folder.getName(),
    counts: {
      total: items.length,
      changed: items.filter(function (x) { return x.syncStatus === 'changed'; }).length,
      new: items.filter(function (x) { return x.syncStatus === 'new'; }).length,
      unchanged: items.filter(function (x) { return x.syncStatus === 'unchanged'; }).length,
      missing: missing.length
    },
    items: items,
    missing: missing
  };
}

function getDriveSyncDefaultsStep5(fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('fileId がありません。');

  const scan = scanDriveSyncStep5();
  const item = scan.items.filter(function (row) {
    return row.fileId === id;
  })[0];

  if (!item) throw new Error('Drive同期対象の資料が見つかりません。');

  return {
    ok: true,
    item: item,
    suggested: {
      categoryId: item.categoryId || 'cat-other',
      ownerDepartment: item.ownerDepartment || '',
      versionLabel: formatDateTime_(DriveApp.getFileById(id).getLastUpdated()),
      validFrom: item.validFrom || '',
      validUntil: item.validUntil || ''
    }
  };
}

function markDriveSourceMissingStep5(sourceId) {
  const id = String(sourceId || '').trim();
  if (!id) throw new Error('sourceId がありません。');
  return workerRequest_('/admin/rag/source-missing', 'post', {
    sourceId: id
  }, true);
}

function listRagAuditStep5(limit) {
  const n = Math.max(1, Math.min(200, Number(limit) || 100));
  const response = workerRequest_('/admin/rag/audit?limit=' + n, 'get', null, true);
  return response && response.result && response.result.logs
    ? response.result.logs
    : [];
}

function previewDriveFileStep5(fileId, options) {
  const file = DriveApp.getFileById(String(fileId || '').trim());
  const info = getStructuredFileInfoStep5_(file);
  const extracted = extractStructuredFileStep5_(file, null, options || {});

  const previewText = extracted.sections
    .map(function (section) {
      const label = section.headingPath || section.sheetName ||
        (section.slideNo ? 'スライド ' + section.slideNo : '本文');
      return '【' + label + '】\n' + section.text;
    })
    .join('\n\n');

  return {
    id: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    kind: info.kind,
    supported: info.supported,
    note: info.note,
    chars: extracted.extractedCharCount,
    sectionCount: extracted.sections.length,
    sheetCount: extracted.sheetCount,
    slideCount: extracted.slideCount,
    units: extracted.units,
    preview: previewText.slice(0, MAX_PREVIEW_CHARS),
    truncated: previewText.length > MAX_PREVIEW_CHARS
  };
}

function registerDriveFileStep5(options) {
  const payload = options || {};
  const fileId = String(payload.fileId || '').trim();
  if (!fileId) throw new Error('登録する資料を選択してください。');
  if (payload.approved !== true) {
    throw new Error('承認済み資料であることを確認してから登録してください。');
  }

  const file = DriveApp.getFileById(fileId);

  if (payload.force !== true) {
    try {
      const currentDocs = listRagDocumentsStep5().filter(function (doc) {
        return doc &&
          doc.isCurrent === true &&
          doc.sourceType === 'drive' &&
          (doc.driveFileId === fileId || doc.sourceId === makeSourceId_(fileId));
      });

      const current = currentDocs.length ? currentDocs[0] : null;
      if (current && current.status === 'active' && current.sourceModifiedAt) {
        const registeredMs = new Date(current.sourceModifiedAt).getTime();
        const driveMs = file.getLastUpdated().getTime();

        const desiredTitle = clean_(payload.title, 300) || file.getName();
        const desiredCategory = clean_(payload.categoryId, 120) || 'cat-other';
        const desiredOwner = clean_(payload.ownerDepartment || payload.owner, 160);
        const desiredValidFrom = clean_(payload.validFrom, 60);
        const desiredValidUntil = clean_(payload.validUntil, 60);

        const sameMetadata =
          String(current.title || '') === String(desiredTitle || '') &&
          String(current.categoryId || '') === String(desiredCategory || '') &&
          String(current.ownerDepartment || '') === String(desiredOwner || '') &&
          String(current.validFrom || '') === String(desiredValidFrom || '') &&
          String(current.validUntil || '') === String(desiredValidUntil || '');

        if (registeredMs && driveMs <= registeredMs + 1000 && sameMetadata) {
          return {
            ok: true,
            skipped: true,
            reason: 'unchanged',
            fileId: fileId,
            sourceId: current.sourceId,
            documentId: current.documentId,
            revisionNo: Number(current.revisionNo || 1),
            message: 'Drive原本と登録メタデータに更新がないため、再Embeddingを行いませんでした。'
          };
        }
      }
    } catch (syncCheckError) {
      console.warn('更新判定をスキップしました: ' + syncCheckError.message);
    }
  }

  const info = getStructuredFileInfoStep5_(file);
  if (!info.supported) throw new Error(info.note || 'この形式はまだ直接登録できません。');

  const extracted = extractStructuredFileStep5_(
    file,
    payload.selectedUnits || null,
    { allowPdfOcr: payload.allowPdfOcr === true }
  );
  if (!extracted.sections.length || !extracted.extractedCharCount) {
    throw new Error('資料本文を取得できませんでした。');
  }
  if (extracted.extractedCharCount > 480000) {
    throw new Error('抽出本文が480,000文字を超えています。資料を分割してください。');
  }

  const lastUpdated = file.getLastUpdated();
  const stagePayload = {
    sourceId: makeSourceId_(fileId),
    sourceType: 'drive',
    driveFileId: fileId,
    fileName: file.getName(),
    title: clean_(payload.title, 300) || file.getName(),
    mimeType: file.getMimeType(),
    categoryId: clean_(payload.categoryId, 120) || 'cat-other',
    ownerDepartment: clean_(payload.ownerDepartment || payload.owner, 160),
    versionLabel: clean_(payload.versionLabel || payload.version, 120) || formatDate_(lastUpdated),
    fileSizeBytes: Number(file.getSize() || 0),
    pageCount: null,
    sheetCount: extracted.sheetCount || 0,
    slideCount: extracted.slideCount || 0,
    sourceModifiedAt: lastUpdated.toISOString(),
    validFrom: clean_(payload.validFrom, 60),
    validUntil: clean_(payload.validUntil, 60),
    approved: true,
    sections: extracted.sections
  };

  const staged = workerRequest_('/admin/rag/stage', 'post', stagePayload, true);
  const stagedResult = staged && staged.result ? staged.result : {};

  if (stagedResult.skipped === true) {
    return {
      ok: true,
      skipped: true,
      reason: stagedResult.reason || 'content_unchanged',
      fileId: fileId,
      sourceId: stagePayload.sourceId,
      documentId: stagedResult.documentId || '',
      revisionNo: Number(stagedResult.revisionNo || 1),
      message: stagedResult.message || '本文内容に変更がないため再Embeddingを省略しました。',
      stage: staged
    };
  }

  const documentId = stagedResult.documentId;
  if (!documentId) throw new Error('D1ステージング後のdocumentIdを取得できませんでした。');

  PropertiesService.getScriptProperties()
    .setProperty(STEP5_LAST_DOCUMENT_PROPERTY, documentId);

  const progress = continueRagRegistrationStep5(documentId);

  return {
    ok: true,
    fileId: fileId,
    sourceId: stagePayload.sourceId,
    title: stagePayload.title,
    stage: staged,
    progress: progress
  };
}

function continueLastRagRegistrationStep5() {
  const documentId = String(
    PropertiesService.getScriptProperties()
      .getProperty(STEP5_LAST_DOCUMENT_PROPERTY) || ''
  ).trim();
  if (!documentId) {
    throw new Error('続行対象のdocumentIdがありません。');
  }
  return continueRagRegistrationStep5(documentId);
}

function continueRagRegistrationStep5(documentId) {
  const id = String(documentId || '').trim();
  if (!id) throw new Error('documentId がありません。');

  let lastIndex = null;
  for (let i = 0; i < STEP5_MAX_INDEX_BATCHES_PER_RUN; i++) {
    lastIndex = workerRequest_('/admin/rag/index-next', 'post', {
      documentId: id,
      limit: 20
    }, true);

    const result = lastIndex && lastIndex.result ? lastIndex.result : {};
    if (result.done === true || Number(result.remaining || 0) === 0) break;
    Utilities.sleep(700);
  }

  const indexResult = lastIndex && lastIndex.result ? lastIndex.result : {};
  if (!(indexResult.done === true || Number(indexResult.remaining || 0) === 0)) {
    return {
      ok: true,
      status: 'indexing',
      documentId: id,
      ready: Number(indexResult.ready || 0),
      total: Number(indexResult.total || 0),
      remaining: Number(indexResult.remaining || 0),
      needsContinue: true
    };
  }

  let finalize = null;
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (attempt > 0) Utilities.sleep(4000);
      finalize = workerRequest_('/admin/rag/finalize', 'post', {
        documentId: id
      }, true);
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      const message = String(e && e.message ? e.message : e);
      const waiting =
        message.indexOf('Vectorizeへの反映待ち') >= 0 ||
        message.indexOf('意味検索への反映を待っています') >= 0;
      if (!waiting) throw e;
    }
  }

  if (!finalize) {
    return {
      ok: true,
      status: 'waiting_finalize',
      documentId: id,
      needsContinue: true,
      message: String(lastError && lastError.message ? lastError.message : 'Vectorize反映待ちです。')
    };
  }

  return {
    ok: true,
    status: 'active',
    documentId: id,
    needsContinue: false,
    finalize: finalize
  };
}

function getStructuredFileInfoStep5_(file) {
  const info = supportInfo_(file.getMimeType());
  return {
    supported: Boolean(info.supported),
    kind: info.label || file.getMimeType() || '不明',
    note: info.note || '',
    requiresOcrConfirmation: Boolean(info.requiresOcrConfirmation)
  };
}

function extractStructuredFileStep5_(file, selectedUnits, options) {
  const mimeType = file.getMimeType();
  const selected = Array.isArray(selectedUnits)
    ? selectedUnits.map(function (v) { return String(v); })
    : null;
  const opts = options || {};

  if (isConvertibleBinaryStep5_(mimeType)) {
    return extractConvertedBinaryStep5_(file, selected, opts);
  }

  let sections = [];
  let units = [];
  let sheetCount = 0;
  let slideCount = 0;

  if (mimeType === MIME.GOOGLE_DOC) {
    sections = extractGoogleDocSectionsStep5_(file.getId());
    units = [{ id: 'document', label: '文書全体', selected: true }];
  } else if (mimeType === MIME.GOOGLE_SHEET) {
    const result = extractSpreadsheetSectionsStep5_(file.getId(), selected);
    sections = result.sections;
    units = result.units;
    sheetCount = result.sheetCount;
  } else if (mimeType === MIME.GOOGLE_SLIDES) {
    const result = extractSlidesSectionsStep5_(file.getId(), selected);
    sections = result.sections;
    units = result.units;
    slideCount = result.slideCount;
  } else {
    const text = extractPlainFileTextStep5_(file);
    sections = [{
      headingPath: '本文',
      text: text
    }];
    units = [{ id: 'text', label: '本文全体', selected: true }];
  }

  sections = sections
    .map(function (section) {
      return {
        pageFrom: section.pageFrom || null,
        pageTo: section.pageTo || null,
        sheetName: section.sheetName || '',
        slideNo: section.slideNo || null,
        headingPath: clean_(section.headingPath, 500),
        text: normalizeExtractedTextStep5_(section.text)
      };
    })
    .filter(function (section) { return Boolean(section.text); });

  return {
    sections: sections,
    units: units,
    sheetCount: sheetCount,
    slideCount: slideCount,
    extractedCharCount: sections.reduce(function (sum, section) {
      return sum + section.text.length;
    }, 0)
  };
}

function isConvertibleBinaryStep5_(mimeType) {
  return [
    MIME.PDF,
    MIME.WORD,
    MIME.WORD_LEGACY,
    MIME.EXCEL,
    MIME.EXCEL_LEGACY,
    MIME.POWERPOINT,
    MIME.POWERPOINT_LEGACY
  ].indexOf(mimeType) >= 0;
}

function conversionTargetMimeStep5_(mimeType) {
  if (mimeType === MIME.WORD || mimeType === MIME.WORD_LEGACY || mimeType === MIME.PDF) {
    return MIME.GOOGLE_DOC;
  }
  if (mimeType === MIME.EXCEL || mimeType === MIME.EXCEL_LEGACY) {
    return MIME.GOOGLE_SHEET;
  }
  if (mimeType === MIME.POWERPOINT || mimeType === MIME.POWERPOINT_LEGACY) {
    return MIME.GOOGLE_SLIDES;
  }
  return '';
}

function extractConvertedBinaryStep5_(file, selected, options) {
  const mimeType = file.getMimeType();
  const isPdf = mimeType === MIME.PDF;
  if (isPdf && options.allowPdfOcr !== true) {
    throw new Error(
      'PDFはGoogle Driveの変換/OCRを使用して本文を抽出します。' +
      '管理画面で「PDF変換/OCRを許可」を確認してからプレビューしてください。'
    );
  }

  const targetMime = conversionTargetMimeStep5_(mimeType);
  if (!targetMime) throw new Error('このファイル形式は変換できません。');

  const tempName = '__komu_ai_temp__' + new Date().getTime() + '_' + file.getName();
  let temp = null;

  try {
    const params = {
      fields: 'id,name,mimeType',
      supportsAllDrives: true
    };
    if (isPdf) params.ocrLanguage = 'ja';

    temp = Drive.Files.create(
      {
        name: tempName,
        mimeType: targetMime
      },
      file.getBlob(),
      params
    );

    if (!temp || !temp.id) {
      throw new Error('Google Drive変換後の一時ファイルIDを取得できませんでした。');
    }

    let result = null;
    if (targetMime === MIME.GOOGLE_DOC) {
      const sections = extractGoogleDocSectionsStep5_(temp.id);
      result = {
        sections: sections,
        units: [{ id: 'document', label: isPdf ? 'PDF変換/OCR全文' : '文書全体', selected: true }],
        sheetCount: 0,
        slideCount: 0
      };
    } else if (targetMime === MIME.GOOGLE_SHEET) {
      result = extractSpreadsheetSectionsStep5_(temp.id, selected);
    } else if (targetMime === MIME.GOOGLE_SLIDES) {
      result = extractSlidesSectionsStep5_(temp.id, selected);
    }

    const sections = (result && result.sections ? result.sections : [])
      .map(function (section) {
        return {
          pageFrom: section.pageFrom || null,
          pageTo: section.pageTo || null,
          sheetName: section.sheetName || '',
          slideNo: section.slideNo || null,
          headingPath: clean_(section.headingPath, 500),
          text: normalizeExtractedTextStep5_(section.text)
        };
      })
      .filter(function (section) { return Boolean(section.text); });

    const extractedCharCount = sections.reduce(function (sum, section) {
      return sum + section.text.length;
    }, 0);

    if (isPdf && extractedCharCount < 20) {
      throw new Error(
        'PDFから十分な文字を取得できませんでした。' +
        '画像品質や原稿状態を確認し、必要なら別のPDFで試してください。'
      );
    }

    return {
      sections: sections,
      units: result && result.units ? result.units : [],
      sheetCount: result && result.sheetCount ? result.sheetCount : 0,
      slideCount: result && result.slideCount ? result.slideCount : 0,
      extractedCharCount: extractedCharCount,
      convertedFromMimeType: mimeType,
      usedPdfOcr: isPdf
    };
  } finally {
    if (temp && temp.id) {
      try {
        Drive.Files.remove(temp.id);
      } catch (cleanupError) {
        console.warn('一時変換ファイルの削除に失敗しました: ' + cleanupError.message);
      }
    }
  }
}

function extractGoogleDocSectionsStep5_(fileId) {
  const doc = DocumentApp.openById(fileId);
  const body = doc.getBody();
  const sections = [];
  let headingPath = [];
  let buffer = [];

  function flush() {
    const text = buffer.join('\n\n').trim();
    if (text) {
      sections.push({
        headingPath: headingPath.filter(Boolean).length ? headingPath.filter(Boolean).join(' > ') : '本文',
        text: text
      });
    }
    buffer = [];
  }

  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    const type = child.getType();

    if (type === DocumentApp.ElementType.PARAGRAPH) {
      const p = child.asParagraph();
      const text = String(p.getText() || '').trim();
      if (!text) continue;

      const level = paragraphHeadingLevelStep5_(p.getHeading());
      if (level > 0) {
        flush();
        headingPath = headingPath.slice(0, level - 1);
        headingPath[level - 1] = text;
      } else {
        buffer.push(text);
      }
    } else if (type === DocumentApp.ElementType.LIST_ITEM) {
      const text = String(child.asListItem().getText() || '').trim();
      if (text) buffer.push('・' + text);
    } else if (type === DocumentApp.ElementType.TABLE) {
      const table = child.asTable();
      const rows = [];
      for (let r = 0; r < table.getNumRows(); r++) {
        const row = table.getRow(r);
        const cells = [];
        for (let k = 0; k < row.getNumCells(); k++) {
          cells.push(String(row.getCell(k).getText() || '').trim());
        }
        const line = cells.join('\t').trim();
        if (line) rows.push(line);
      }
      if (rows.length) buffer.push(rows.join('\n'));
    }
  }

  flush();

  if (!sections.length) {
    const text = String(body.getText() || '').trim();
    if (text) sections.push({ headingPath: '本文', text: text });
  }
  return sections;
}

function paragraphHeadingLevelStep5_(heading) {
  if (heading === DocumentApp.ParagraphHeading.HEADING1) return 1;
  if (heading === DocumentApp.ParagraphHeading.HEADING2) return 2;
  if (heading === DocumentApp.ParagraphHeading.HEADING3) return 3;
  if (heading === DocumentApp.ParagraphHeading.HEADING4) return 4;
  if (heading === DocumentApp.ParagraphHeading.HEADING5) return 5;
  if (heading === DocumentApp.ParagraphHeading.HEADING6) return 6;
  return 0;
}

function extractSpreadsheetSectionsStep5_(fileId, selected) {
  const ss = SpreadsheetApp.openById(fileId);
  const sheets = ss.getSheets();
  const units = sheets.map(function (sheet) {
    return {
      id: sheet.getName(),
      label: sheet.getName(),
      selected: !selected || selected.indexOf(sheet.getName()) >= 0
    };
  });

  const sections = [];
  sheets.forEach(function (sheet) {
    if (selected && selected.indexOf(sheet.getName()) < 0) return;

    const values = sheet.getDataRange().getDisplayValues();
    const lines = [];
    values.forEach(function (row) {
      const line = row.map(function (v) {
        return String(v || '').trim();
      }).join('\t').trim();
      if (line) lines.push(line);
    });

    if (lines.length) {
      sections.push({
        sheetName: sheet.getName(),
        headingPath: 'シート > ' + sheet.getName(),
        text: lines.join('\n')
      });
    }
  });

  return {
    sections: sections,
    units: units,
    sheetCount: sheets.length
  };
}

function extractSlidesSectionsStep5_(fileId, selected) {
  const presentation = SlidesApp.openById(fileId);
  const slides = presentation.getSlides();
  const units = slides.map(function (slide, index) {
    const no = String(index + 1);
    return {
      id: no,
      label: 'スライド ' + no,
      selected: !selected || selected.indexOf(no) >= 0
    };
  });

  const sections = [];
  slides.forEach(function (slide, index) {
    const no = String(index + 1);
    if (selected && selected.indexOf(no) < 0) return;

    const blocks = [];
    slide.getPageElements().forEach(function (element) {
      const type = element.getPageElementType();

      if (type === SlidesApp.PageElementType.SHAPE) {
        const shape = element.asShape();
        const text = String(shape.getText().asString() || '').trim();
        if (text) blocks.push(text);
      } else if (type === SlidesApp.PageElementType.TABLE) {
        const table = element.asTable();
        for (let r = 0; r < table.getNumRows(); r++) {
          const cells = [];
          for (let col = 0; col < table.getNumColumns(); col++) {
            cells.push(String(table.getCell(r, col).getText().asString() || '').trim());
          }
          const line = cells.join('\t').trim();
          if (line) blocks.push(line);
        }
      }
    });

    if (blocks.length) {
      sections.push({
        slideNo: index + 1,
        headingPath: 'スライド ' + (index + 1),
        text: blocks.join('\n\n')
      });
    }
  });

  return {
    sections: sections,
    units: units,
    slideCount: slides.length
  };
}

function extractPlainFileTextStep5_(file) {
  const mimeType = file.getMimeType();
  let text = file.getBlob().getDataAsString('UTF-8');

  if (mimeType === MIME.CSV) {
    try {
      const rows = Utilities.parseCsv(text);
      text = rows.map(function (row) {
        return row.map(function (v) { return String(v || '').trim(); })
          .join('\t').trim();
      }).filter(Boolean).join('\n');
    } catch (e) {
      // CSVとして解釈できない場合は元テキストをそのまま使用する。
    }
  }

  return normalizeExtractedTextStep5_(text);
}

function normalizeExtractedTextStep5_(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}
