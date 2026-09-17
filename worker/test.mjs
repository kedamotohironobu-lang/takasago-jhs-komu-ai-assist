import assert from 'node:assert/strict';
import worker, { validatePayload, buildMessages, pickCorsOrigin } from './worker.mjs';

let n=0; const ok=(cond,msg='assert')=>{assert.ok(cond,msg);n++;}; const eq=(a,b)=>{assert.equal(a,b);n++;};
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

let res=await worker.fetch(new Request('https://x/health'),{}); eq(res.status,200); eq((await res.json()).ok,true);
res=await worker.fetch(new Request('https://x/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({toolId:'faq',input:'出張の手続きは？'})}),{}); eq(res.status,409); eq((await res.json()).error.code,'FAQ_NOT_READY');
res=await worker.fetch(new Request('https://x/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({toolId:'parent',input:'test'})}),{}); eq(res.status,503); eq((await res.json()).error.code,'NO_PROVIDER_CONFIGURED');

const realFetch=globalThis.fetch; let calls=[];
globalThis.fetch=async (url,init)=>{
  calls.push(String(url));
  if (String(url).includes('cerebras')) return new Response(JSON.stringify({error:{message:'temporary'}}),{status:503,headers:{'Content-Type':'application/json'}});
  if (String(url).includes('groq')) return new Response(JSON.stringify({choices:[{message:{content:'Groq fallback success'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  throw new Error('unexpected');
};
res=await worker.fetch(new Request('https://x/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({toolId:'parent',input:'テスト連絡'})}),{CEREBRAS_API_KEY:'x',GROQ_API_KEY:'y'});
eq(res.status,200); const data=await res.json(); eq(data.provider,'groq'); eq(data.text,'Groq fallback success'); eq(calls.length,2); ok(calls[0].includes('cerebras')); ok(calls[1].includes('groq'));
globalThis.fetch=realFetch;

console.log(`STEP3 unit/integration tests: ${n} assertions passed`);
