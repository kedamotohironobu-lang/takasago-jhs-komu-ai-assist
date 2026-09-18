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

async function embedWithGemini(env, text) {
  const key = String(env?.GEMINI_API_KEY || '').trim();
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY is not configured'), { code:'GEMINI_KEY_NOT_CONFIGURED' });

  const model = RAG_CONFIG.embedding.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`;

  const response = await fetch(url, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-goog-api-key':key
    },
    body:JSON.stringify({
      content:{ parts:[{ text:cleanEmbeddingText(text, 12000) }] },
      output_dimensionality:RAG_CONFIG.embedding.dimensions
    })
  });

  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}

  if (!response.ok) {
    throw Object.assign(new Error(`Gemini embedding HTTP ${response.status}`), {
      code:'GEMINI_EMBEDDING_FAILED',
      status:response.status,
      detail:data?.error?.message || raw.slice(0,300)
    });
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

async function embedDocument(env, document) {
  return embedWithGemini(env, formatEmbeddingDocument(document));
}

async function embedQuery(env, query) {
  return embedWithGemini(env, formatEmbeddingQuery(query));
}

export {
  formatEmbeddingDocument,
  formatEmbeddingQuery,
  embedWithGemini,
  embedDocument,
  embedQuery
};
