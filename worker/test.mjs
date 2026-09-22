import assert from 'node:assert/strict';
import worker, { validatePayload, buildMessages, pickCorsOrigin } from './worker.mjs';
import { applyEvidenceGate, buildEvidence, buildFtsQuery } from './rag-retrieval.mjs';
import { ensureOperationalSchema } from './usage-telemetry.mjs';
import { embedWithGemini, isRetryableEmbeddingStatus } from './embedding-gemini.mjs';

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
eq(health.version,'6.9.5');

// STEP8-11: FTS alias expansion for common school-office paraphrases.
{
  const q1=buildFtsQuery('出張が終わったあと、報告は誰に出せばいいですか？');
  ok(q1.includes('復命書'));
  const q2=buildFtsQuery('勤務の途中で帰らなければならないときは、どんな手続が必要ですか？');
  ok(q2.includes('早退'));
}

// STEP8-11: Vector#1 + FTS#1 is accepted at 0.70+, while weaker evidence remains blocked.
{
  const accepted=applyEvidenceGate([
    {
      chunkId:'c-top1-strong',
      documentId:'doc-top1',
      authoritative:true,
      vectorRank:1,
      vectorScore:0.7192,
      ftsRank:1,
      ftsScore:-0.001,
      rrfScore:0.03279,
      fusedRank:1
    }
  ]);
  eq(accepted[0].accepted,true);
  eq(accepted[0].gateReason,'top1_hybrid_agreement');

  const rejected=applyEvidenceGate([
    {
      chunkId:'c-top1-weak',
      documentId:'doc-top1-weak',
      authoritative:true,
      vectorRank:1,
      vectorScore:0.6999,
      ftsRank:1,
      ftsScore:-0.001,
      rrfScore:0.03279,
      fusedRank:1
    }
  ]);
  eq(rejected[0].accepted,false);
}

// STEP6 operational schema: runtime must verify migrated tables without executing DDL.
{
  const operationalTables = [
    'usage_events','usage_sources','feedback_events','improvement_actions','automation_runs'
  ];
  let preparedSql='';
  let bound=[];
  const env={
    RAG_DB:{
      prepare(sql){
        preparedSql=String(sql);
        return {
          bind(...args){
            bound=args;
            return {
              async all(){
                return {results:operationalTables.map(name=>({name}))};
              }
            };
          }
        };
      }
    }
  };
  const schema=await ensureOperationalSchema(env);
  eq(schema.ok,true);
  eq(schema.missingTables.length,0);
  ok(preparedSql.includes('sqlite_master'));
  eq(bound.length,operationalTables.length);
}

{
  const env={
    RAG_DB:{
      prepare(){
        return {
          bind(){
            return {
              async all(){
                return {results:[{name:'usage_events'}]};
              }
            };
          }
        };
      }
    }
  };
  let schemaError=null;
  try { await ensureOperationalSchema(env); } catch (e) { schemaError=e; }
  eq(schemaError?.code,'OPERATIONAL_SCHEMA_NOT_READY');
  ok(Array.isArray(schemaError?.missingTables));
  ok(schemaError.missingTables.includes('automation_runs'));
}

// Gemini embedding retries transient 429/5xx instead of failing immediately.
eq(isRetryableEmbeddingStatus(429),true);
eq(isRetryableEmbeddingStatus(503),true);
eq(isRetryableEmbeddingStatus(400),false);

{
  const previousFetch=globalThis.fetch;
  let embeddingCalls=0;
  globalThis.fetch=async ()=>{
    embeddingCalls++;
    if(embeddingCalls===1){
      return new Response(JSON.stringify({error:{message:'rate limited'}}),{
        status:429,
        headers:{'Content-Type':'application/json','Retry-After':'0'}
      });
    }
    return new Response(JSON.stringify({
      embedding:{values:Array(384).fill(0.001)}
    }),{
      status:200,
      headers:{'Content-Type':'application/json'}
    });
  };
  const values=await embedWithGemini({
    GEMINI_API_KEY:'test',
    GEMINI_EMBEDDING_MAX_ATTEMPTS:'2',
    GEMINI_EMBEDDING_RETRY_BASE_MS:'50'
  },'test');
  eq(embeddingCalls,2);
  eq(values.length,384);
  globalThis.fetch=previousFetch;
}

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

  // Real-school calibration pattern:
  // the same authoritative document has multiple chunks that independently rank
  // in both Vector and FTS. This should be accepted even when vector scores are
  // below the strict 0.75 hybrid threshold, while vector-only evidence stays strict.
  const multiChunkHybrid = applyEvidenceGate([
    {
      chunkId:'c-lock-1',
      documentId:'doc-facilities',
      authoritative:true,
      vectorRank:1,
      vectorScore:0.6842,
      ftsRank:2,
      ftsScore:-0.001,
      rrfScore:0.03252,
      fusedRank:1
    },
    {
      chunkId:'c-lock-2',
      documentId:'doc-facilities',
      authoritative:true,
      vectorRank:3,
      vectorScore:0.6542,
      ftsRank:1,
      ftsScore:-0.002,
      rrfScore:0.03227,
      fusedRank:2
    },
    {
      chunkId:'c-lock-vector-only',
      documentId:'doc-facilities',
      authoritative:true,
      vectorRank:2,
      vectorScore:0.6675,
      ftsRank:null,
      ftsScore:null,
      rrfScore:0.01613,
      fusedRank:3
    }
  ]);
  eq(multiChunkHybrid[0].accepted,true);
  eq(multiChunkHybrid[0].gateReason,'hybrid_multi_chunk_agreement');
  eq(multiChunkHybrid[1].accepted,true);
  eq(multiChunkHybrid[1].gateReason,'hybrid_multi_chunk_agreement');
  eq(multiChunkHybrid[2].accepted,false);

  const oneWeakHybrid = applyEvidenceGate([
    {
      chunkId:'c-one-weak',
      documentId:'doc-one-weak',
      authoritative:true,
      vectorRank:1,
      vectorScore:0.68,
      ftsRank:1,
      ftsScore:-0.001,
      rrfScore:0.0327,
      fusedRank:1
    }
  ]);
  eq(oneWeakHybrid[0].accepted,false);

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
