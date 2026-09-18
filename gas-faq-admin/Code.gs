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
  MARKDOWN: 'text/markdown'
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
      updatedAt: formatDateTime_(file.getLastUpdated()),
      size: Number(file.getSize() || 0),
      url: file.getUrl()
    });
  }

  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt), 'ja'));
  return rows;
}

function previewDriveFile(fileId) {
  const file = DriveApp.getFileById(String(fileId || '').trim());
  const extracted = extractFileText_(file);
  return {
    id: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    chars: extracted.length,
    preview: extracted.slice(0, MAX_PREVIEW_CHARS),
    truncated: extracted.length > MAX_PREVIEW_CHARS
  };
}

function registerDriveFile(options) {
  const payload = options || {};
  const fileId = String(payload.fileId || '').trim();
  if (!fileId) throw new Error('登録する資料を選択してください。');
  if (payload.approved !== true) throw new Error('承認済み資料であることを確認してから登録してください。');

  const file = DriveApp.getFileById(fileId);
  const text = extractFileText_(file);
  if (!text.trim()) throw new Error('資料本文を取得できませんでした。');

  const lastUpdated = file.getLastUpdated();
  const source = {
    sourceId: makeSourceId_(fileId),
    title: file.getName(),
    version: clean_(payload.version, 80) || formatDate_(lastUpdated),
    updatedAt: formatDate_(lastUpdated),
    validFrom: clean_(payload.validFrom, 40),
    validUntil: clean_(payload.validUntil, 40),
    owner: clean_(payload.owner, 120),
    approved: true,
    url: file.getUrl(),
    text: text.slice(0, MAX_TEXT_CHARS)
  };

  const result = workerRequest_('/admin/faq/source', 'post', source, true);
  return {
    ok: true,
    fileId,
    sourceId: source.sourceId,
    title: source.title,
    result
  };
}

function listRegisteredSources() {
  const response = workerRequest_('/admin/faq/sources', 'get', null, true);
  return response.result || { configured: false, sources: [] };
}

function removeRegisteredSource(sourceId) {
  const id = String(sourceId || '').trim();
  if (!id) throw new Error('sourceId がありません。');
  return workerRequest_('/admin/faq/remove', 'post', { sourceId: id }, true);
}

function getFaqStatus() {
  return workerRequest_('/health/faq', 'get', null, false);
}

function getFaqFolder_() {
  const folderId = String(PropertiesService.getScriptProperties().getProperty(PROP.FAQ_FOLDER_ID) || '').trim();
  if (!folderId) throw new Error('FAQ_FOLDER_ID が未設定です。管理画面でGoogle DriveフォルダIDを設定してください。');
  return DriveApp.getFolderById(folderId);
}

function extractFileText_(file) {
  const mimeType = file.getMimeType();
  const support = supportInfo_(mimeType);
  if (!support.supported) {
    throw new Error(support.note || 'このファイル形式はV1では未対応です。');
  }

  let text = '';
  if (mimeType === MIME.GOOGLE_DOC) {
    text = DocumentApp.openById(file.getId()).getBody().getText();
  } else if (mimeType === MIME.GOOGLE_SHEET) {
    text = extractSpreadsheet_(file.getId());
  } else if (mimeType === MIME.GOOGLE_SLIDES) {
    text = extractSlides_(file.getId());
  } else {
    text = file.getBlob().getDataAsString('UTF-8');
  }

  text = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();

  if (text.length > MAX_TEXT_CHARS) {
    throw new Error('資料本文が100,000文字を超えています。資料を分割して登録してください。');
  }
  return text;
}

function extractSpreadsheet_(fileId) {
  const ss = SpreadsheetApp.openById(fileId);
  const blocks = [];

  ss.getSheets().forEach(sheet => {
    const range = sheet.getDataRange();
    const values = range.getDisplayValues();
    blocks.push('【シート：' + sheet.getName() + '】');
    values.forEach(row => {
      const line = row.map(v => String(v || '').trim()).join('\t').trim();
      if (line) blocks.push(line);
    });
    blocks.push('');
  });

  return blocks.join('\n');
}

function extractSlides_(fileId) {
  const presentation = SlidesApp.openById(fileId);
  const blocks = [];

  presentation.getSlides().forEach((slide, index) => {
    blocks.push('【スライド ' + (index + 1) + '】');

    slide.getPageElements().forEach(element => {
      const type = element.getPageElementType();

      if (type === SlidesApp.PageElementType.SHAPE) {
        const shape = element.asShape();
        if (shape.getText) {
          const text = shape.getText().asString().trim();
          if (text) blocks.push(text);
        }
      } else if (type === SlidesApp.PageElementType.TABLE) {
        const table = element.asTable();
        for (let r = 0; r < table.getNumRows(); r++) {
          const cells = [];
          for (let c = 0; c < table.getNumColumns(); c++) {
            cells.push(table.getCell(r, c).getText().asString().trim());
          }
          const line = cells.join('\t').trim();
          if (line) blocks.push(line);
        }
      }
    });

    blocks.push('');
  });

  return blocks.join('\n');
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

  return map[mimeType] || {
    supported: false,
    label: mimeType || '不明',
    note: 'V1では未対応です。PDF・Word・Excel・PowerPointは、まずGoogleドキュメント／スプレッドシート／スライドへ変換してください。'
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
