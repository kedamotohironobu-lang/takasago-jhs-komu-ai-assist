const INDEX_KEY = 'faq:index:v1';
const MAX_SOURCES = 200;
const MAX_CHUNKS = 4000;
const MAX_SOURCE_TEXT = 100000;

function cleanText(value, max=10000) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function normalize(value) {
  return cleanText(value, 200000)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function ngrams(text, n=2) {
  const s = normalize(text);
  const out = new Set();
  for (let i=0; i<=s.length-n; i++) out.add(s.slice(i, i+n));
  return out;
}

function validDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isSourceActive(source, now=new Date()) {
  if (!source || source.approved !== true) return false;
  const from = validDate(source.validFrom);
  const until = validDate(source.validUntil);
  if (from && now < from) return false;
  if (until && now > until) return false;
  return true;
}

function scoreChunk(query, chunk) {
  const q = normalize(query);
  const t = normalize([chunk.heading, chunk.text].filter(Boolean).join(' '));
  if (!q || !t) return 0;

  let score = 0;
  if (t.includes(q)) score += 100;

  const q2 = ngrams(q, 2);
  const t2 = ngrams(t, 2);
  let overlap = 0;
  for (const g of q2) if (t2.has(g)) overlap++;

  const coverage = q2.size ? overlap / q2.size : 0;
  score += coverage * 60;
  if (overlap >= 4) score += 10;
  if (coverage < 0.18 && overlap < 3) return 0;
  return score;
}

async function readIndex(env) {
  if (!env?.FAQ_KV || typeof env.FAQ_KV.get !== 'function') {
    return { configured:false, index:null };
  }
  const raw = await env.FAQ_KV.get(INDEX_KEY);
  if (!raw) return { configured:true, index:{version:1,updatedAt:null,sources:[]} };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.sources)) throw new Error('invalid index');
    return { configured:true, index:parsed };
  } catch {
    return { configured:true, index:{version:1,updatedAt:null,sources:[],corrupt:true} };
  }
}

async function writeIndex(env, index) {
  if (!env?.FAQ_KV || typeof env.FAQ_KV.put !== 'function') throw new Error('FAQ_KV_NOT_CONFIGURED');
  await env.FAQ_KV.put(INDEX_KEY, JSON.stringify(index));
}

function chunkPlainText(text) {
  const src = cleanText(text, MAX_SOURCE_TEXT);
  if (!src) return [];
  const paras = src.split(/\n{2,}/).map(s=>s.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > 900 && buf) {
      chunks.push({ id:`c${chunks.length+1}`, heading:'', page:'', text:buf });
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push({ id:`c${chunks.length+1}`, heading:'', page:'', text:buf });
  return chunks;
}

function normalizeChunks(chunks, rawText='') {
  const list = Array.isArray(chunks) && chunks.length ? chunks : chunkPlainText(rawText);
  return list.slice(0, 300).map((c,i)=>({
    id: cleanText(c?.id || `c${i+1}`, 80),
    heading: cleanText(c?.heading, 200),
    page: cleanText(c?.page, 80),
    text: cleanText(c?.text, 1800)
  })).filter(c=>c.text);
}

function validateSourcePayload(payload) {
  const sourceId = cleanText(payload?.sourceId, 80);
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(sourceId)) {
    return {ok:false,code:'INVALID_SOURCE_ID',message:'sourceId は英数字・._-で3〜80文字にしてください。'};
  }
  const title = cleanText(payload?.title, 200);
  if (!title) return {ok:false,code:'SOURCE_TITLE_REQUIRED',message:'資料名が必要です。'};
  const chunks = normalizeChunks(payload?.chunks, payload?.text);
  if (!chunks.length) return {ok:false,code:'SOURCE_CONTENT_REQUIRED',message:'資料本文またはchunksが必要です。'};
  return {
    ok:true,
    source:{
      sourceId,
      title,
      version:cleanText(payload?.version,80),
      updatedAt:cleanText(payload?.updatedAt,40),
      validFrom:cleanText(payload?.validFrom,40),
      validUntil:cleanText(payload?.validUntil,40),
      url:cleanText(payload?.url,500),
      owner:cleanText(payload?.owner,120),
      approved:payload?.approved === true,
      chunks
    }
  };
}

async function upsertFaqSource(env, payload) {
  const validated = validateSourcePayload(payload);
  if (!validated.ok) return validated;

  const loaded = await readIndex(env);
  if (!loaded.configured) return {ok:false,code:'FAQ_KV_NOT_CONFIGURED',message:'FAQ_KV が設定されていません。'};

  const sources = (loaded.index.sources || []).filter(s=>s.sourceId !== validated.source.sourceId);
  sources.push(validated.source);
  if (sources.length > MAX_SOURCES) return {ok:false,code:'TOO_MANY_SOURCES',message:'登録資料数の上限を超えています。'};

  const totalChunks = sources.reduce((sum,s)=>sum + (Array.isArray(s.chunks)?s.chunks.length:0),0);
  if (totalChunks > MAX_CHUNKS) return {ok:false,code:'TOO_MANY_CHUNKS',message:'登録チャンク数の上限を超えています。'};

  const index = {version:1,updatedAt:new Date().toISOString(),sources};
  await writeIndex(env,index);
  return {ok:true,sourceId:validated.source.sourceId,sourceCount:sources.length,totalChunks,updatedAt:index.updatedAt};
}

async function removeFaqSource(env, sourceId) {
  const loaded = await readIndex(env);
  if (!loaded.configured) return {ok:false,code:'FAQ_KV_NOT_CONFIGURED',message:'FAQ_KV が設定されていません。'};
  const id = cleanText(sourceId,80);
  const before = loaded.index.sources || [];
  const sources = before.filter(s=>s.sourceId !== id);
  const index = {version:1,updatedAt:new Date().toISOString(),sources};
  await writeIndex(env,index);
  return {ok:true,removed:sources.length !== before.length,sourceCount:sources.length,updatedAt:index.updatedAt};
}

async function faqStatus(env) {
  const loaded = await readIndex(env);
  if (!loaded.configured) return {configured:false,sourceCount:0,activeSourceCount:0,updatedAt:null};
  const sources = loaded.index.sources || [];
  return {
    configured:true,
    sourceCount:sources.length,
    activeSourceCount:sources.filter(s=>isSourceActive(s)).length,
    updatedAt:loaded.index.updatedAt || null,
    corrupt:Boolean(loaded.index.corrupt)
  };
}

async function retrieveFaq(env, query, limit=5) {
  const loaded = await readIndex(env);
  if (!loaded.configured) return {configured:false,hasSources:false,hits:[]};

  const active = (loaded.index.sources || []).filter(s=>isSourceActive(s));
  const scored = [];
  for (const source of active) {
    for (const chunk of (source.chunks || [])) {
      const score = scoreChunk(query, chunk);
      if (score <= 0) continue;
      scored.push({
        score,
        sourceId:source.sourceId,
        title:source.title,
        version:source.version || '',
        updatedAt:source.updatedAt || '',
        validUntil:source.validUntil || '',
        url:source.url || '',
        owner:source.owner || '',
        chunkId:chunk.id || '',
        heading:chunk.heading || '',
        page:chunk.page || '',
        text:chunk.text || ''
      });
    }
  }
  scored.sort((a,b)=>b.score-a.score);
  return {configured:true,hasSources:active.length>0,hits:scored.slice(0,Math.max(1,Math.min(8,limit)))};
}

function buildFaqContext(hits) {
  return hits.map((h,i)=>{
    const meta = [
      `sourceId=${h.sourceId}`,
      `資料名=${h.title}`,
      h.version ? `版=${h.version}` : '',
      h.updatedAt ? `更新日=${h.updatedAt}` : '',
      h.page ? `ページ=${h.page}` : '',
      h.heading ? `見出し=${h.heading}` : '',
      h.url ? `URL=${h.url}` : ''
    ].filter(Boolean).join(' / ');
    return `【根拠${i+1}】${meta}\n${h.text}`;
  }).join('\n\n');
}

export {
  INDEX_KEY,
  isSourceActive,
  scoreChunk,
  faqStatus,
  retrieveFaq,
  buildFaqContext,
  validateSourcePayload,
  upsertFaqSource,
  removeFaqSource
};
