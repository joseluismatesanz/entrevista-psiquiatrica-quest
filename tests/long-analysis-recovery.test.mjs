import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const gate = await readFile(new URL('../long-interview-prefetch-gate-v061.js',import.meta.url),'utf8');
const backend = await readFile(new URL('../backend-client.js',import.meta.url),'utf8');
const transcript = 'PACIENTE: Entrevista ficticia para comprobar la espera del informe.\n'.repeat(500);
const flush = async()=>{for(let i=0;i<12;i++) await Promise.resolve();};
function fixture(withBackend=false){
 let now=0,serial=0; const timers=new Map(), calls=[], events=new Map(), nodes=new Map();
 const classList=()=>{const s=new Set(); return {add:x=>s.add(x),remove:x=>s.delete(x),contains:x=>s.has(x),toggle:(x,on)=>on?s.add(x):s.delete(x)}};
 const node=()=>({value:'',textContent:'',dataset:{},classList:classList(),listeners:{},setAttribute(){},focus(){},addEventListener(k,f){this.listeners[k]=f},appendChild(n){nodes.set(n.id,n)}});
 for(const id of ['caseText','workflowActions','analyzeCase','prepareReportEmail','sessionMessage','analyzeCaseTimer','screen-input','screen-report','screen-review','routingGrid','sourcesList','missingList','conflictList','alertList','reportEditor','validateCheck','copyReport']) nodes.set(id,node());
 nodes.get('caseText').value=transcript;
 const document={body:node(),getElementById:id=>nodes.get(id),createElement:node,querySelectorAll:()=>[]};
 const window={CLINICAL_API_URL:'https://test.invalid',__LONG_INTERVIEW_TRANSCRIPT:transcript.trim(),__LONG_INTERVIEW_VERIFIED_BLOCKS:[{text:transcript,proof:'test'}],__LONG_INTERVIEW_EVIDENCE:[{}],__CLINICAL_ANALYSIS_PREFETCH:new Map(),scrollTo(){},addEventListener(k,f){events.set(k,f)},dispatchEvent(e){events.get(e.type)?.(e)},fetch(input,init){return new Promise((resolve,reject)=>{calls.push({input,init,resolve,reject});init?.signal?.addEventListener('abort',()=>reject(init.signal.reason))})}};
 const context={window,document,Response,Map,AbortController,DOMException,CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts?.detail}},performance:{now:()=>now},Date:{now:()=>now},console:{error(){}},setTimeout(f,ms){const id=++serial;timers.set(id,{f,at:now+ms});return id},clearTimeout:id=>timers.delete(id),setInterval:()=>++serial,clearInterval(){}};
 vm.runInNewContext(gate,context);
 window.ClinicalRequest={fetchWithDeadline:(url,init)=>window.fetch(url,init)};
 if(withBackend)vm.runInNewContext(backend,context);
 return {window,nodes,calls,events,document,async advance(ms){now+=ms;for(const [id,t] of timers)if(t.at<=now){timers.delete(id);t.f()}await flush()},request(signal){return window.fetch('/api/analyze',{method:'POST',body:JSON.stringify({transcript}),signal})},start(){events.get('clinical-long-attribution-ready')({detail:{transcript}})}};
}
const ok={assessment:{sections:{}},report:'INFORME PSIQUIÁTRICO\nInforme ficticio de prueba.'};
const reply=(call,status=200,payload=ok)=>call.resolve(new Response(JSON.stringify(payload),{status}));
test('195-second long analysis is shared by prefetch and repeated foreground actions',async()=>{
 const f=fixture(); f.start(); await flush(); const a=f.request(), b=f.request(); await f.advance(195000);
 assert.equal(f.calls.length,1);assert.ok(transcript.length>22405);assert.equal(JSON.parse(f.calls[0].init.body).transcript,transcript.trim());assert.equal(f.calls[0].init.signal.aborted,false);
 reply(f.calls[0]); assert.deepEqual(await (await a).json(),ok);assert.deepEqual(await (await b).json(),ok);
 assert.equal((await f.request()).status,200);assert.equal(f.calls.length,1);
});
test('failed shared request remains visible and explicit retry launches fresh request',async()=>{
 const f=fixture(true);const a=f.window.runClinicalReportGeneration(),b=f.window.runClinicalReportGeneration();assert.equal(a,b);await flush();reply(f.calls[0],503,{message:'Servicio temporalmente no disponible'});assert.equal(await a,null);
 assert.equal(f.nodes.get('caseText').value,transcript);assert.match(f.nodes.get('analysisStatus').textContent,/Servicio temporalmente/);assert.equal(f.nodes.get('reviewPreservedTranscript').classList.contains('hidden'),false);assert.equal(f.nodes.get('analyzeCase').disabled,false);
 f.nodes.get('reviewPreservedTranscript').listeners.click();assert.equal(f.document.body.classList.contains('transcription-actions-only'),false);
 const retry=f.window.runClinicalReportGeneration();await flush();assert.equal(f.calls.length,2);reply(f.calls[1]);assert.deepEqual(await retry,ok);assert.equal(f.nodes.get('reportEditor').textContent,ok.report);
});
test('cancelled subscriber does not cancel shared analysis or duplicate it',async()=>{
 const f=fixture();const controller=new AbortController();const a=f.request(controller.signal);await flush();controller.abort();await assert.rejects(a,{name:'AbortError'});assert.equal(f.calls[0].init.signal.aborted,false);reply(f.calls[0]);assert.equal((await f.request()).status,200);assert.equal(f.calls.length,1);
});
test('shared timeout releases request and permits retry with transcript intact',async()=>{
 const f=fixture();const a=f.request();await flush();await f.advance(295001);assert.equal((await a).status,504);const b=f.request();await flush();assert.equal(f.calls.length,2);reply(f.calls[1]);assert.equal((await b).status,200);
});
test('edited transcript bypasses previous analysis',async()=>{
 const f=fixture();const request=f.window.fetch('/api/analyze',{method:'POST',body:JSON.stringify({transcript:'Texto corregido'})});await flush();assert.equal(JSON.parse(f.calls[0].init.body).transcript,'Texto corregido');reply(f.calls[0]);assert.equal((await request).status,200);
});
