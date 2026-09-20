import { RAG_CONFIG } from './rag-config.mjs';

function cleanEmbeddingText(value, max = 12000) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, max);
}

function formatEmbeddingDocument({ title, heading, text }) {
  const safeTitle = cleanEmbeddingText([title, heading].filter(Boolean).join(' > '), 500) || 'none';
  const safeText = cleanEmbeddingText(text, 12000);
  return `title: ${safeTitle} | text: ${safeText}`;
}

function formatEmbeddingQuery(query) {
  const safe = cleanEmbeddingText(query, 4000);
  return `task: question answering | query: ${safe}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(response) {
  const raw = String(response?.headers?.get('Retry-After') || '').trim();
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(10000, Math.round(seconds * 1000));
  }

  const at = Date.parse(raw);
  if (Number.isFinite(at)) {
    return Math.max(0, Math.min(10000, at - Date.now()));
  }

  return 0;
}

function isRetryableEmbeddingStatus(status) {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

async function embedWithGemini(env, text) {
  const key = String(env?.GEMINI_API_KEY || '').trim();
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY is not configured'), { code:'GEMINI_KEY_NOT_CONFIGURED' });

  const model = RAG_CONFIG.embedding.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`;
  const maxAttempts = Math.max(1, Math.min(5, Number(env?.GEMINI_EMBEDDING_MAX_ATTEMPTS) || 4));
  const baseDelayMs = Math.max(50, Math.min(5000, Number(env?.GEMINI_EMBEDDING_RETRY_BASE_MS) || 800));

  let lastFailure = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'x-goog-api-key':key
        },
        body:JSON.stringify({
          content:{ parts:[{ text:cleanEmbeddingText(text, 12000) }] },
          embedContentConfig:{
            outputDimensionality:RAG_CONFIG.embedding.dimensions
          }
        })
      });
    } catch (networkError) {
      lastFailure = Object.assign(
        new Error('Gemini embedding network error'),
        {
          code:'GEMINI_EMBEDDING_NETWORK_ERROR',
          status:0,
          detail:String(networkError?.message || networkError || ''),
          attempt,
          maxAttempts
        }
      );

      if (attempt >= maxAttempts) throw lastFailure;
      await sleep(Math.min(10000, baseDelayMs * (2 ** (attempt - 1))));
      continue;
    }

    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}

    if (!response.ok) {
      const retryable = isRetryableEmbeddingStatus(response.status);
      const detail = data?.error?.message || raw.slice(0,300);
      lastFailure = Object.assign(
        new Error(
          response.status === 429
            ? 'Gemini embedding HTTP 429 (rate limit / quota)'
            : `Gemini embedding HTTP ${response.status}`
        ),
        {
          code:response.status === 429
            ? 'GEMINI_EMBEDDING_RATE_LIMITED'
            : 'GEMINI_EMBEDDING_FAILED',
          status:response.status,
          detail,
          retryable,
          attempt,
          maxAttempts
        }
      );

      if (!retryable || attempt >= maxAttempts) throw lastFailure;

      const headerDelay = retryAfterMs(response);
      const exponentialDelay = Math.min(10000, baseDelayMs * (2 ** (attempt - 1)));
      await sleep(Math.max(headerDelay, exponentialDelay));
      continue;
    }

    const values = data?.embedding?.values;
    if (!Array.isArray(values) || values.length !== RAG_CONFIG.embedding.dimensions) {
      throw Object.assign(new Error('Gemini embedding dimension mismatch'), {
        code:'EMBEDDING_DIMENSION_MISMATCH',
        expected:RAG_CONFIG.embedding.dimensions,
        actual:Array.isArray(values) ? values.length : 0
      });
    }

    return values;
  }

  throw lastFailure || Object.assign(
    new Error('Gemini embedding failed'),
    { code:'GEMINI_EMBEDDING_FAILED' }
  );
}

async function embedDocument(env, document) {
  return embedWithGemini(env, formatEmbeddingDocument(document));
}

async function embedQuery(env, query) {
  return embedWithGemini(env, formatEmbeddingQuery(query));
}

export {
  cleanEmbeddingText,
  formatEmbeddingDocument,
  formatEmbeddingQuery,
  retryAfterMs,
  isRetryableEmbeddingStatus,
  embedWithGemini,
  embedDocument,
  embedQuery
};
