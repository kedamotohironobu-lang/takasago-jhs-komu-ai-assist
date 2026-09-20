import assert from 'node:assert/strict';
import worker, { validatePayload, buildMessages, pickCorsOrigin } from './worker.mjs';
import { applyEvidenceGate, buildEvidence } from './rag-retrieval.mjs';

let n=0;
const ok=(cond,msg='assert')=>{assert.ok(cond,msg);n++;};
const eq=(a,b)=>{assert.equal(a,b);n++;};

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
eq(res.status,200);
let health=await res.json();
eq(health.ok,true);
eq(health.version,'6.9.0');

res=await worker.fetch(new Request('https://x/health/faq'),{});
eq(res.status,200);
let statusData=await res.json();
eq(statusData.ok,true);
eq(statusData.faq.mode,'rag-v2');
eq(statusData.faq.legacyKv,'retired');
eq(statusData.faq.publicLegacyRoutes,false);

res=await worker.fetch(new Request('https://x/api/generate',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({toolId:'faq',input:'テスト手続きは？'})
}),{});
eq(res.status,401);
eq((await res.json()).error.code,'STAFF_AUTH_REQUIRED');

res=await worker.fetch(new Request('https://x/admin/automation/status'),{});
eq(res.status,401);
eq((await res.json()).error.code,'ADMIN_AUTH_REQUIRED');

res=await worker.fetch(new Request('https://x/admin/automation/run-record',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({runType:'daily',status:'ok'})
}),{});
eq(res.status,401);
eq((await res.json()).error.code,'ADMIN_AUTH_REQUIRED');

res=await worker.fetch(new Request('https://x/api/generate',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({toolId:'parent',input:'test'})
}),{});
eq(res.status,503); eq((await res.json()).error.code,'NO_PROVIDER_CONFIGURED');

const realFetch=globalThis.fetch;
let calls=[];
globalThis.fetch=async (url,init)=>{
  calls.push(String(url));
  if (String(url).includes('cerebras')) {
    return new Response(JSON.stringify({error:{message:'temporary'}}),{
      status:503,
      headers:{'Content-Type':'application/json'}
    });
  }
  if (String(url).includes('groq')) {
    return new Response(JSON.stringify({
      choices:[{message:{content:'Groq fallback success'}}]
    }),{
      status:200,
      headers:{'Content-Type':'application/json'}
    });
  }
  throw new Error('unexpected fetch: '+String(url));
};

res=await worker.fetch(new Request('https://x/api/generate',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({toolId:'parent',input:'テスト連絡'})
}),{CEREBRAS_API_KEY:'x',GROQ_API_KEY:'y'});

eq(res.status,200);
let data=await res.json();
eq(data.provider,'groq');
eq(data.text,'Groq fallback success');
eq(calls.length,2);
ok(calls[0].includes('cerebras'));
ok(calls[1].includes('groq'));

globalThis.fetch=realFetch;

console.log(`STEP6-9 core unit/integration tests: ${n} assertions passed`);

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
