import assert from 'node:assert/strict';
import worker, { validatePayload, buildMessages, pickCorsOrigin } from './worker.mjs';
import { faqStatus, retrieveFaq, validateSourcePayload, upsertFaqSource } from './faq-rag.mjs';
import { applyEvidenceGate, buildEvidence } from './rag-retrieval.mjs';

let n=0;
const ok=(cond,msg='assert')=>{assert.ok(cond,msg);n++;};
const eq=(a,b)=>{assert.equal(a,b);n++;};

class MemoryKV {
  constructor(){ this.map=new Map(); }
  async get(key){ return this.map.has(key) ? this.map.get(key) : null; }
  async put(key,value){ this.map.set(key,String(value)); }
}

const ids=['document','check','parent','newsletter','meeting','lesson','research','mail','rewrite','faq'];
for (const id of ids) eq(validatePayload({toolId:id,input:'テスト'}).ok,true);
eq(validatePayload({toolId:'unknown',input:'x'}).code,'INVALID_TOOL');
eq(validatePayload({toolId:'parent',input:'   '}).code,'EMPTY_INPUT');
eq(validatePayload({toolId:'parent',input:'x'.repeat(12000)}).ok,true);
eq(validatePayload({toolId:'parent',input:'x'.repeat(12001)}).code,'INPUT_TOO_LONG');
eq(validatePayload({toolId:'parent',input:'x',quickEdit:'hack'}).code,'INVALID_QUICK_EDIT');
for (const q of ['shorter','casual','formal','retry']) eq(validatePayload({toolId:'parent',input:'x',quickEdit:q}).ok,true);

for (const id of ids.filter(x=>x!=='faq')) {
  const v=validatePayload({toolId:id,input:'入力例',options:{length:'標準',tone:'丁寧'}});
  const m=buildMessages(v);
  eq(m.length,2); eq(m[0].role,'system'); eq(m[1].role,'user'); ok(m[0].content.includes('機能別指示'));
}
const c=buildMessages(validatePayload({toolId:'check',input:'参加は20名。内訳12名と9名。'}));
ok(c[0].content.includes('修正必須')); ok(c[1].content.includes('参加は20名'));
const q=buildMessages(validatePayload({toolId:'parent',input:'連絡',quickEdit:'shorter',previousOutput:'前回文章'}));
ok(q[1].content.includes('前回文章')); ok(q[1].content.includes('より短く'));

const reqAllowed=new Request('https://api.example.com/api/generate',{headers:{Origin:'https://kedamotohironobu-lang.github.io'}});
eq(pickCorsOrigin(reqAllowed,{}),'https://kedamotohironobu-lang.github.io');
const reqDenied=new Request('https://api.example.com/api/generate',{headers:{Origin:'https://evil.example'}});
eq(pickCorsOrigin(reqDenied,{}),'');

let res=await worker.fetch(new Request('https://x/health'),{});
eq(res.status,200); eq((await res.json()).ok,true);

res=await worker.fetch(new Request('https://x/health/faq'),{});
eq(res.status,200);
let statusData=await res.json();
eq(statusData.faq.configured,false);

res=await worker.fetch(new Request('https://x/api/generate',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({toolId:'faq',input:'テスト手続きは？'})
}),{});
eq(res.status,503); eq((await res.json()).error.code,'FAQ_RAG_NOT_CONFIGURED');

const kv=new MemoryKV();
const bad=validateSourcePayload({sourceId:'x',title:'資料',text:'本文'});
eq(bad.ok,false);

const seeded=await upsertFaqSource({FAQ_KV:kv},{
  sourceId:'test-rule-001',
  title:'STEP4テスト用資料',
  version:'test',
  updatedAt:'2026-09-18',
  approved:true,
  chunks:[
    {id:'c1',heading:'テスト手続き',page:'1',text:'テスト手続きAは、承認後に提出する。'},
    {id:'c2',heading:'別項目',page:'2',text:'備品テストBは、所定の記録欄に記載する。'}
  ]
});
eq(seeded.ok,true);

const faqState=await faqStatus({FAQ_KV:kv});
eq(faqState.configured,true); eq(faqState.activeSourceCount,1);

const retrieved=await retrieveFaq({FAQ_KV:kv},'テスト手続きAはどうしますか？');
ok(retrieved.hits.length>=1);
eq(retrieved.hits[0].sourceId,'test-rule-001');

res=await worker.fetch(new Request('https://x/api/generate',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({toolId:'faq',input:'まったく関係のない宇宙飛行の規程は？'})
}),{FAQ_KV:kv});
eq(res.status,200);
let noHit=await res.json();
eq(noHit.provider,'retrieval-only');
ok(noHit.text.includes('登録資料では確認できません'));

res=await worker.fetch(new Request('https://x/api/generate',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({toolId:'parent',input:'test'})
}),{});
eq(res.status,503); eq((await res.json()).error.code,'NO_PROVIDER_CONFIGURED');

const realFetch=globalThis.fetch;
let calls=[];
globalThis.fetch=async (url,init)=>{
  calls.push(String(url));
  if (String(url).includes('cerebras')) return new Response(JSON.stringify({error:{message:'temporary'}}),{status:503,headers:{'Content-Type':'application/json'}});
  if (String(url).includes('groq')) return new Response(JSON.stringify({choices:[{message:{content:'Groq fallback success'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  throw new Error('unexpected');
};

res=await worker.fetch(new Request('https://x/api/generate',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({toolId:'parent',input:'テスト連絡'})
}),{CEREBRAS_API_KEY:'x',GROQ_API_KEY:'y'});
eq(res.status,200);
let data=await res.json();
eq(data.provider,'groq'); eq(data.text,'Groq fallback success');
eq(calls.length,2); ok(calls[0].includes('cerebras')); ok(calls[1].includes('groq'));

calls=[];
res=await worker.fetch(new Request('https://x/api/generate',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({toolId:'faq',input:'テスト手続きAはどうしますか？'})
}),{FAQ_KV:kv,CEREBRAS_API_KEY:'x',GROQ_API_KEY:'y'});
eq(res.status,200);
data=await res.json();
eq(data.provider,'groq');
ok(Array.isArray(data.sources) && data.sources.length>=1);
eq(data.sources[0].sourceId,'test-rule-001');
ok(calls.some(x=>x.includes('cerebras')));
ok(calls.some(x=>x.includes('groq')));

globalThis.fetch=realFetch;

console.log(`STEP4 unit/integration tests: ${n} assertions passed`);


// STEP5-6 evidence gate tests
{
  const direct = applyEvidenceGate([
    {
      chunkId:'c-good',
      authoritative:true,
      vectorRank:1,
      vectorScore:0.8282954,
      ftsRank:1,
      ftsScore:-0.00001,
      rrfScore:0.0327,
      fusedRank:1
    },
    {
      chunkId:'c-distractor',
      authoritative:true,
      vectorRank:2,
      vectorScore:0.7431142,
      ftsRank:2,
      ftsScore:-0.000002,
      rrfScore:0.0322,
      fusedRank:2
    }
  ]);
  eq(direct[0].accepted,true);
  eq(direct[0].gateReason,'hybrid_agreement');
  eq(direct[1].accepted,false);

  const paraphrase = applyEvidenceGate([
    {
      chunkId:'c-good',
      authoritative:true,
      vectorRank:1,
      vectorScore:0.7997454,
      ftsRank:1,
      ftsScore:-0.000002,
      rrfScore:0.0327,
      fusedRank:1
    },
    {
      chunkId:'c-other',
      authoritative:true,
      vectorRank:2,
      vectorScore:0.70004636,
      ftsRank:null,
      ftsScore:null,
      rrfScore:0.0161,
      fusedRank:2
    }
  ]);
  eq(paraphrase[0].accepted,true);
  eq(paraphrase[1].accepted,false);

  const negative = applyEvidenceGate([
    {
      chunkId:'c-unrelated-1',
      authoritative:true,
      vectorRank:1,
      vectorScore:0.6101101,
      ftsRank:null,
      ftsScore:null,
      rrfScore:0.0163,
      fusedRank:1
    },
    {
      chunkId:'c-unrelated-2',
      authoritative:true,
      vectorRank:2,
      vectorScore:0.5521759,
      ftsRank:null,
      ftsScore:null,
      rrfScore:0.0161,
      fusedRank:2
    }
  ]);
  eq(negative[0].accepted,false);
  eq(negative[1].accepted,false);

  const evidence = buildEvidence([
    {
      ...direct[0],
      documentId:'doc-1',
      sourceId:'source-1',
      revisionNo:1,
      title:'資料',
      fileName:'資料.txt',
      versionLabel:'v1',
      categoryId:'cat-other',
      categoryName:'その他',
      ownerDepartment:'test',
      headingPath:'備品A',
      pageFrom:null,
      pageTo:null,
      sheetName:'',
      slideNo:null,
      chunkNo:1,
      text:'テスト備品Aの確認日は金曜日です。'
    },
    {
      ...direct[1],
      documentId:'doc-1',
      sourceId:'source-1',
      revisionNo:1,
      title:'資料',
      fileName:'資料.txt',
      versionLabel:'v1',
      categoryId:'cat-other',
      categoryName:'その他',
      ownerDepartment:'test',
      headingPath:'会議B',
      pageFrom:null,
      pageTo:null,
      sheetName:'',
      slideNo:null,
      chunkNo:2,
      text:'テスト会議Bの資料は前日までに確認します。'
    }
  ],4);
  eq(evidence.length,1);
  eq(evidence[0].chunkIds[0],'c-good');
}

console.log('STEP5-6 evidence gate tests passed');
