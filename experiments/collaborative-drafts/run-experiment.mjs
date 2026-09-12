// THROWAWAY evidence driver: real Yjs documents, loopback HTTP, PostgreSQL and process death.
import * as Y from 'yjs';
import pg from 'pg';
import {fork,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {hash,canonical,encode,decode,content} from './model.mjs';
let db=new pg.Client({user:'postgres'});await db.connect();db.on('error',()=>{});
for(const role of ['knowledge','catalog','execution'])await db.query(`CREATE ROLE ${role} LOGIN PASSWORD 'throwaway'; CREATE SCHEMA ${role} AUTHORIZATION ${role}; ALTER ROLE ${role} SET search_path TO ${role}; SET ROLE ${role}; CREATE TABLE state(id text PRIMARY KEY,body jsonb NOT NULL); CREATE TABLE inbox(scope text,id text,digest text,verdict jsonb,PRIMARY KEY(scope,id)); RESET ROLE;`);
let child,port,n=0,checks=0,current,results=[],traces=[];
async function start(){child=fork('./worker.mjs',[],{stdio:['ignore','inherit','inherit','ipc']});port=(await once(child,'message'))[0].port;}
async function stop(){if(child?.exitCode===null&&child?.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const files=['model.mjs','worker.mjs','run-experiment.mjs','package-lock.json'];
const sourceHashes=Object.fromEntries(files.map(f=>[f,hash(readFileSync(f,'utf8'))]));
async function request(ctx,doc,op,args={},actor='alice',fault,delay=0){
 const body={ctx,doc,op,id:`request-${++n}`,...args};if(delay)await sleep(delay);
 const r=await fetch(`http://127.0.0.1:${port}`,{method:'POST',headers:{'x-actor':actor,...(fault?{'x-fault':fault}:{})},body:JSON.stringify(body)});
 if(delay)await sleep(delay);const value=await r.json();if(r.status!==200)throw Error(JSON.stringify(value));return value;
}
async function snapshot(label){const state={};for(const role of ['knowledge','catalog','execution'])state[role]={state:(await db.query(`SELECT * FROM ${role}.state ORDER BY id`)).rows,inbox:(await db.query(`SELECT * FROM ${role}.inbox ORDER BY scope,id`)).rows};traces.push({scenario:current,label,state});}
function ok(value,label){checks++;assert.ok(value,label);}
function eq(a,b,label){checks++;assert.deepEqual(a,b,label);}
async function scenario(name,fn){current=name;const before=checks,t=performance.now();await fn();await snapshot('after scenario');results.push({name,checks:checks-before,ms:Math.round(performance.now()-t)});process.stdout.write(`PASS ${name} (${checks-before})\n`);}
function edit(d,fn){let updates=[];const cb=u=>updates.push(u);d.on('update',cb);d.transact(()=>fn(d));d.off('update',cb);return Buffer.from(Y.mergeUpdates(updates)).toString('base64');}
async function getClient(ctx,doc){return decode((await request(ctx,doc,'read')).update);}
async function sync(d,ctx,doc,delay=0){const r=await request(ctx,doc,'read',{},'alice',undefined,delay);if(r.update)Y.applyUpdate(d,Buffer.from(r.update,'base64'));return r;}
async function append(doc,text,actor='alice'){const d=await getClient('knowledge',doc);return request('knowledge',doc,'edit',{update:edit(d,x=>x.getText('markdown').insert(x.getText('markdown').length,text))},actor);}
async function submit(doc,head=0){const p=await request('knowledge',doc,'preview');return request('knowledge',doc,'submit',{token:p.token,expectedHead:head});}
async function runState(doc='run'){return request('execution',doc,'read');}
async function observe(e,run='run'){return request('execution',run,'observe',{event:e});}
async function decision(op,s,run='run',extra={}){return request('execution',run,op,{revision:s.pending?.revision,sourceVersion:s.pending?.seq,version:s.version,...extra});}
async function events(doc){return (await db.query('SELECT body FROM knowledge.state WHERE id=$1',[doc])).rows[0].body.outbox;}
await start();
try{
 await scenario('two clients concurrently insert Markdown and converge',async()=>{
  const a=await getClient('knowledge','spec'),b=await getClient('knowledge','spec');
  const ua=edit(a,d=>d.getText('markdown').insert(0,'Alice ')),ub=edit(b,d=>d.getText('markdown').insert(0,'Bob '));
  const rs=await Promise.all([request('knowledge','spec','edit',{update:ua},'alice'),request('knowledge','spec','edit',{update:ub},'bob')]);
  await sync(a,'knowledge','spec');await sync(b,'knowledge','spec');eq(content(a),content(b),'convergence');ok(content(a).markdown.includes('Alice')&&content(a).markdown.includes('Bob'),'both inserted runs survive');eq(rs.map(x=>x.actor).sort(),['alice','bob'],'authenticated fixture envelope attribution');
 });
 await scenario('delete changes content without advancing Yjs state vector',async()=>{
  const d=await getClient('knowledge','spec'),vector=Buffer.from(Y.encodeStateVector(d)).toString('hex'),before=hash(content(d));
  const update=edit(d,x=>x.getText('markdown').delete(0,1));eq(Buffer.from(Y.encodeStateVector(d)).toString('hex'),vector,'vector equality cannot identify reviewed bytes');ok(before!==hash(content(d)),'content hash changes');await request('knowledge','spec','edit',{update});
 });
 await scenario('exact retry replays durable edit receipt; conflicting identity rejected',async()=>{
  const d=await getClient('knowledge','spec'),p={id:'stable-edit',update:edit(d,x=>x.getText('markdown').insert(0,'stable '))};
  const a=await request('knowledge','spec','edit',p),b=await request('knowledge','spec','edit',p);eq(a,b,'stable receipt');eq((await request('knowledge','spec','edit',{...p,update:encode(new Y.Doc())})).status,'identity_conflict','conflicting bytes');eq((await request('knowledge','spec','edit',p,'bob')).status,'identity_conflict','cannot relabel receipt actor');
 });
 await scenario('acknowledged edits survive killed worker and database restart',async()=>{
  const before=await request('knowledge','spec','read');await stop();await db.end();execFileSync('docker',['restart',process.env.AA_EXPERIMENT_CONTAINER],{stdio:'ignore'});
  for(let i=0;i<60;i++){try{execFileSync('docker',['exec',process.env.AA_EXPERIMENT_CONTAINER,'pg_isready','-U','postgres'],{stdio:'ignore'});break;}catch{await sleep(100);}}
  // A fresh connection is necessary after actual database restart.
  process.env.PGPORT=execFileSync('docker',['port',process.env.AA_EXPERIMENT_CONTAINER,'5432/tcp'],{encoding:'utf8'}).trim().split(':').at(-1);
  db=new pg.Client({user:'postgres'});await db.connect();await start();const after=await request('knowledge','spec','read');eq(after,before,'all durable draft bytes/sequence retained');
 });
 await scenario('process death before commit leaves no acknowledged edit',async()=>{
  const d=await getClient('knowledge','spec'),before=content(d),p={id:'precommit',update:edit(d,x=>x.getText('markdown').insert(0,'uncommitted '))};
  await request('knowledge','spec','edit',p,'alice','before-commit').catch(()=>{});await start();eq((await request('knowledge','spec','read')).content,before,'transaction rolled back');
  const retry=await request('knowledge','spec','edit',p);ok(retry.integrated,'same unsatisfied identity may retry');
 });
 await scenario('process death after commit replays lost acknowledgment',async()=>{
  const d=await getClient('knowledge','spec'),p={id:'lost-ack',update:edit(d,x=>x.getText('markdown').insert(0,'committed '))};
  await request('knowledge','spec','edit',p,'alice','after-commit').catch(()=>{});await start();const once=await request('knowledge','spec','edit',p),twice=await request('knowledge','spec','edit',p);eq(once,twice,'lost acknowledgment resolves to same durable receipt');
  const state=(await db.query("SELECT body FROM knowledge.state WHERE id='spec'")).rows[0].body;eq(state.history.filter(x=>x.id==='lost-ack').length,1,'one durable edit');
 });
 await scenario('out-of-order CRDT dependency persists but blocks preview until integrated',async()=>{
  const d=new Y.Doc(),u1=edit(d,x=>x.getText('markdown').insert(0,'one')),u2=edit(d,x=>x.getText('markdown').insert(3,'two'));
  const r=await request('knowledge','dependency','edit',{update:u2});eq(r.integrated,false,'receipt marks missing dependency');eq((await request('knowledge','dependency','preview')).status,'dependencies_missing','cannot snapshot incomplete state');
  await stop();await start();await request('knowledge','dependency','edit',{update:u1});eq((await request('knowledge','dependency','read')).content.markdown,'onetwo','pending update survives restart');ok((await request('knowledge','dependency','preview')).token,'complete snapshot available');
 });
 await scenario('snapshot freezes reviewed bytes while later edits continue',async()=>{
  const p=await request('knowledge','spec','preview');await append('spec',' later');const r=await request('knowledge','spec','submit',{id:'submit-1',token:p.token,expectedHead:0});
  eq(r.digest,p.digest,'exact preview content submitted');eq(r.content,p.content,'immutable bytes');ok((await request('knowledge','spec','read')).content.markdown!==r.content.markdown,'draft continues independently');
 });
 await scenario('same submission identity replays and conflicting payload cannot change revision',async()=>{
  const state=(await db.query("SELECT body FROM knowledge.state WHERE id='spec'")).rows[0].body,p={id:'submit-1',token:state.revisions[0].snapshot,expectedHead:0};
  const r=await request('knowledge','spec','submit',p);eq(r.revision,'revision-1','repeat does not create version');eq((await request('knowledge','spec','submit',{...p,expectedHead:1})).status,'identity_conflict','payload conflict');
 });
 await scenario('competing submissions use head comparison and preserve both previews',async()=>{
  const p=await request('knowledge','spec','preview');await append('spec',' newer');const q=await request('knowledge','spec','preview');
  const rs=await Promise.all([request('knowledge','spec','submit',{token:p.token,expectedHead:1},'alice'),request('knowledge','spec','submit',{token:q.token,expectedHead:1},'bob')]);
  eq(rs.map(x=>x.status).sort(),['head_conflict','submitted'],'only one wins same predecessor');eq((await request('knowledge','spec','read')).head,2,'one source version');
  const s=(await db.query("SELECT body FROM knowledge.state WHERE id='spec'")).rows[0].body;ok(s.snapshots[p.token]&&s.snapshots[q.token],'losing proposal remains reviewable');
 });
 await scenario('submission lost acknowledgment retains immutable revision and outbox',async()=>{
  const p=await request('knowledge','spec','preview'),args={id:'submission-lost',token:p.token,expectedHead:2};
  await request('knowledge','spec','submit',args,'alice','after-commit').catch(()=>{});await start();const r=await request('knowledge','spec','submit',args);eq(r.sourceVersion,3,'replay exact source version');eq((await events('spec')).length,3,'revision and event committed once');
 });
 await scenario('graph concurrent fields converge; invalid intermediate graph cannot publish',async()=>{
  const seed=new Y.Doc();let update=edit(seed,d=>{d.getMap('nodes').set('a',{kind:'call',action:'test'});d.getArray('order').push(['a']);});await request('catalog','graph','edit',{update});
  const a=await getClient('catalog','graph'),b=await getClient('catalog','graph');
  const ua=edit(a,d=>d.getMap('nodes').set('b',{kind:'call',action:'build'})),ub=edit(b,d=>d.getMap('nodes').set('c',{kind:'call',action:'review'}));
  await Promise.all([request('catalog','graph','edit',{update:ua}),request('catalog','graph','edit',{update:ub},'bob')]);await sync(a,'catalog','graph');await sync(b,'catalog','graph');eq(content(a),content(b),'independent graph edits converge');
  const bad=await request('catalog','graph','preview');ok(bad.validation.includes('orphan_node'),'draft may be structurally invalid');eq((await request('catalog','graph','submit',{token:bad.token,expectedHead:0})).status,'invalid_graph','publication blocked');
  update=edit(a,d=>d.getArray('order').push(['b','c']));await request('catalog','graph','edit',{update});const good=await request('catalog','graph','preview');eq(good.validation,[],'repaired fixture sequence');eq((await request('catalog','graph','submit',{token:good.token,expectedHead:0})).status,'submitted','valid graph publishes');
 });
 await scenario('same graph field converges to one value; both edits remain durable history',async()=>{
  const a=await getClient('catalog','graph'),b=await getClient('catalog','graph');
  await Promise.all([request('catalog','graph','edit',{update:edit(a,d=>d.getMap('nodes').set('a',{kind:'call',action:'alice-action'}))},'alice'),request('catalog','graph','edit',{update:edit(b,d=>d.getMap('nodes').set('a',{kind:'call',action:'bob-action'}))},'bob')]);
  await sync(a,'catalog','graph');await sync(b,'catalog','graph');eq(content(a),content(b),'same-field conflict converges');ok(['alice-action','bob-action'].includes(content(a).nodes.a.action),'one winner, not semantic intent merge');
  const history=(await db.query("SELECT body FROM catalog.state WHERE id='graph'")).rows[0].body.history;eq(history.slice(-2).map(x=>x.actor).sort(),['alice','bob'],'both accepted edit envelopes retained');
 });
 await scenario('graph deletion and invalid behavioral values cannot change published version',async()=>{
  const d=await getClient('catalog','graph');await request('catalog','graph','edit',{update:edit(d,x=>x.getMap('nodes').delete('a'))});let p=await request('catalog','graph','preview');ok(p.validation.includes('dangling_node'),'converged draft can have missing reference');eq((await request('catalog','graph','submit',{token:p.token,expectedHead:1})).status,'invalid_graph','dangling reference blocked');
  for(const node of [{kind:'call',action:{}},{kind:'call',action:'test',unrecognizedBehavior:true}]){await request('catalog','graph','edit',{update:edit(d,x=>x.getMap('nodes').set('a',node))});p=await request('catalog','graph','preview');ok(p.validation.includes('unsupported_or_incomplete_call'),'fixture validates action type/known fields');eq((await request('catalog','graph','submit',{token:p.token,expectedHead:1})).status,'invalid_graph','invalid behavioral content blocked');}
  eq((await request('catalog','graph','read')).head,1,'previous published version remains unchanged');
 });
 await scenario('stale agent proposal preserves bytes without overwriting newer human work',async()=>{
  const base=await request('knowledge','spec','read'),agent=decode(base.update);const update=edit(agent,d=>{d.getText('markdown').delete(0,d.getText('markdown').length);d.getText('markdown').insert(0,'agent replacement');});
  await append('spec',' human newest','bob');const before=await request('knowledge','spec','read');const r=await request('knowledge','spec','agent',{baseSeq:base.seq,baseHash:hash(base.content),update},'agent');eq(r.status,'conflict','stale proposal requires review');eq((await request('knowledge','spec','read')).content,before.content,'human work intact');eq(r.update,update,'agent proposal retained');
 });
 await scenario('current agent proposal uses exact base and ordinary durable acceptance',async()=>{
  const base=await request('knowledge','spec','read'),d=decode(base.update);const r=await request('knowledge','spec','agent',{baseSeq:base.seq,baseHash:hash(base.content),update:edit(d,x=>x.getText('markdown').insert(0,'accepted agent '))},'agent');ok(r.integrated,'current proposal integrates');eq(r.actor,'agent','separate principal attribution');
 });
 await scenario('human and agent proposals race under one source transaction lock',async()=>{
  const base=await request('knowledge','spec','read'),a=decode(base.update),b=decode(base.update);
  const rs=await Promise.all([request('knowledge','spec','edit',{update:edit(a,x=>x.getText('markdown').insert(0,'human race '))},'bob'),request('knowledge','spec','agent',{baseSeq:base.seq,baseHash:hash(base.content),update:edit(b,x=>x.getText('markdown').insert(0,'agent race '))},'agent')]);
  ok(rs[0].integrated,'human edit acknowledged');ok(rs[1].status==='conflict'||rs[1].integrated,'agent accepted at matching base or retained as conflict');ok((await request('knowledge','spec','read')).content.markdown.includes('human race'),'human insertion retained');
 });
 await scenario('unauthorized ingress cannot persist or relabel accepted history',async()=>{
  const before=await request('knowledge','spec','read'),r=await fetch(`http://127.0.0.1:${port}`,{method:'POST',headers:{'x-actor':'intruder'},body:JSON.stringify({ctx:'knowledge',doc:'spec',op:'edit',id:'intruder',update:encode(new Y.Doc())})});eq(r.status,403,'fixture policy rejects');eq(await request('knowledge','spec','read'),before,'no canonical change');
 });
 await scenario('source submission and Execution observation are separate commits',async()=>{
  let s=await runState();eq(s.pinned,'baseline','source submission did not mutate run');eq(s.status,'running','not yet observed');const es=await events('spec');await observe(es[0]);s=await runState();eq(s.pinned,'baseline','observation keeps original manifest');eq(s.status,'replan_required','new dependent work pauses');eq(s.wait.valid,false,'unresolved old wait invalidated');
 });
 await scenario('out-of-order submission pauses with separate gap; older event cannot regress proposal',async()=>{
  const es=await events('spec');eq((await observe(es[2])).status,'gap','future event creates gap');let s=await runState();eq((await decision('retain',s)).status,'event_gap','retain cannot clear missing source history');await observe(es[1]);s=await runState();eq(s.seen,3,'contiguous history restored');eq(s.pending.seq,3,'latest pending proposal retained');eq((await observe(es[0])).status,'duplicate','redelivery no second pause');eq((await observe({...es[0],digest:'wrong'})).status,'event_conflict','same sequence differing payload rejected');
 });
 await scenario('stale approval cannot resume an observed changed scope',async()=>{
  const s=await runState();eq((await request('execution','run','approve',{wait:'wait-0',revision:'baseline',version:0})).status,'stale_approval','old answer rejected');eq((await runState()).approvals,[],'no acceptance');
 });
 await scenario('second submitted revision invalidates an in-flight retain choice',async()=>{
  const old=await runState();await append('spec',' fourth');await submit('spec',3);await observe((await events('spec'))[3]);eq((await decision('retain',old)).status,'stale_decision','review must name current pending version');eq((await runState()).pending.seq,4,'second proposal visible');
 });
 await scenario('retain replaces invalid wait; previous answer cannot approve replacement',async()=>{
  const s=await runState();eq((await decision('retain',s)).status,'retained','explicit retain');const next=await runState();eq(next.pinned,'baseline','retained original manifest');ok(next.wait.id!=='wait-0','new wait identity');eq((await request('execution','run','approve',{wait:'wait-0',revision:'baseline',version:next.version})).status,'stale_approval','old wait cannot answer replacement');eq((await request('execution','run','approve',{wait:next.wait.id,revision:'baseline',version:next.version})).status,'approved','fresh reply required');
 });
 await scenario('accepted approval survives retaining same scope, without answering new wait',async()=>{
  await append('spec',' fifth');await submit('spec',4);await observe((await events('spec'))[4]);const s=await runState();eq(s.approvals.length,1,'accepted history preserved');await decision('retain',s);const retained=await runState();eq(retained.approvals[0].revision,'baseline','existing approval remains bound to original scope');eq(retained.wait.id,s.wait.id,'no new wait for resolved gate');eq(retained.wait.resolved,true,'accepted response stays resolved');eq(retained.wait.valid,false,'not reopened for another response');
 });
 await scenario('Execution process crash retains observed proposal and inbox verdict',async()=>{
  await append('spec',' sixth');await submit('spec',5);const event=(await events('spec'))[5];await request('execution','run','observe',{id:'observe-lost',event},'alice','after-commit').catch(()=>{});await start();const r=await request('execution','run','observe',{id:'observe-lost',event});eq(r.status,'observed','lost observation ack replays');eq((await runState()).pending.seq,6,'durable pending proposal');
 });
 await scenario('adoption cannot clear writer, effects or checkpoint obligations',async()=>{
  for(const obligation of ['writer','effects','checkpoint']){await request('execution','run','gates',{obligations:{[obligation]:true}});let s=await runState();eq((await decision('adopt',s,'run',{admission:{id:'successor',units:1,checkpoint:'verified-fixture'}})).status,'recovery_blocked',`${obligation} gates adoption`);await request('execution','run','gates',{obligations:{[obligation]:false}});}
 });
 await scenario('adoption needs new bounded admission; successor starts at entry without approvals',async()=>{
  let s=await runState();eq((await decision('adopt',s)).status,'admission_required','no implicit budget');eq((await decision('adopt',s,'run',{admission:{id:'successor',units:3,checkpoint:'verified-fixture'}})).status,'admission_required','grant cannot exceed bound');const r=await decision('adopt',s,'run',{admission:{id:'successor',units:1,checkpoint:'verified-fixture'}});eq(r.status,'adopted','new admission');eq(r.successor.approvals,[],'no approvals copied');eq(r.successor.start,'entry','new run starts at entry');eq(r.successor.pinned,'revision-6','exact selected revision');eq(r.successor.delivery,'fixture-delivery','resource lineage preserved in fixture');
 });
 await scenario('superseded predecessor cannot reopen or create a second successor',async()=>{
  const before=await runState();await append('spec',' seventh');await submit('spec',6);eq((await observe((await events('spec'))[6])).status,'superseded','late event cannot reopen predecessor');eq((await decision('retain',before)).status,'superseded','retain cannot resurrect predecessor');eq((await decision('adopt',before)).status,'superseded','no second adoption');eq(await runState(),before,'terminal state preserved');
 });
 await scenario('source context identity prevents Catalog/Knowledge aliasing',async()=>{
  const graph=(await db.query("SELECT body FROM catalog.state WHERE id='graph'")).rows[0].body.outbox[0];eq((await observe(graph,'other-run')).status,'wrong_source','wrong owner stream rejected');
 });
 await scenario('database roles prevent cross-context draft writes',async()=>{
  const c=new pg.Client({user:'execution'});await c.connect();let denied=false;try{await c.query("UPDATE knowledge.state SET body='{}' WHERE id='spec'");}catch(e){denied=e.code==='42501';}await c.end();ok(denied,'Execution cannot write Knowledge');
 });
 await scenario('five replicas: 50-KiB Markdown, 100 nodes, two reduced runs, 60-second disconnect',async()=>{
  const seed=new Y.Doc();await request('knowledge','load','edit',{update:edit(seed,d=>{d.getText('markdown').insert(0,'x'.repeat(50*1024));for(let i=0;i<100;i++){d.getMap('nodes').set(`n${i}`,{kind:'call',action:'test'});d.getArray('order').push([`n${i}`]);}})});
  const clients=await Promise.all(Array.from({length:5},()=>getClient('knowledge','load'))),actors=['alice','bob','carol','dave','eve'];
  const disconnectedAt=performance.now();const offline=edit(clients[4],d=>d.getText('markdown').insert(0,'offline-eve '));const latencies=[];
  for(let round=0;round<4;round++)await Promise.all(clients.slice(0,4).map(async(d,i)=>{const t=performance.now();const update=edit(d,x=>x.getText('markdown').insert(0,`${actors[i]}-${round} `));await request('knowledge','load','edit',{update},actors[i],undefined,50);await Promise.all(clients.slice(0,4).map(c=>sync(c,'knowledge','load',50)));latencies.push(performance.now()-t);}));
  await request('execution','load-run-1','read',{source:'knowledge/load'});await request('execution','load-run-2','read',{source:'knowledge/load'});await submit('load');const event=(await events('load'))[0];await Promise.all([observe(event,'load-run-1'),observe(event,'load-run-2')]);
  const remaining=60000-(performance.now()-disconnectedAt);if(remaining>0)await sleep(remaining);
  const reconnectStart=performance.now();await request('knowledge','load','edit',{update:offline},'eve',undefined,50);await Promise.all(clients.map(c=>sync(c,'knowledge','load',50)));const reconnectMs=performance.now()-reconnectStart;
  for(const d of clients)eq(content(d),content(clients[0]),'all five converge');ok(content(clients[0]).markdown.includes('offline-eve'),'offline unacknowledged edit accepted on reconnect');for(let round=0;round<4;round++)for(const actor of actors.slice(0,4))ok(content(clients[0]).markdown.includes(`${actor}-${round}`),'all acknowledged insertions visible');eq(content(clients[0]).order.length,100,'100-node fixture retained');ok(content(clients[0]).markdown.length>=50*1024,'50-KiB document retained');
  latencies.sort((a,b)=>a-b);const p95=latencies[Math.ceil(latencies.length*.95)-1];ok(p95<2000,'reduced connected propagation under 2s');ok(reconnectMs<10000,'reduced reconnect under 10s');
  writeFileSync('load-measurements.json',JSON.stringify({replicas:5,reducedRuns:2,nodes:100,initialMarkdownBytes:51200,disconnectMs:performance.now()-disconnectedAt-reconnectMs,oneWayArtificialDelayMs:50,transport:'loopback HTTP; full-state pull; four connected clients; no browser/real WAN/harness',sampleCount:latencies.length,latenciesMs:latencies,p95Ms:p95,reconnectMs},null,2));
 });
 assert.deepEqual(Object.fromEntries(files.map(f=>[f,hash(readFileSync(f,'utf8'))])),sourceHashes,'source cannot change during evidence run');
 writeFileSync('results.json',JSON.stringify({date:new Date().toISOString(),node:process.version,checks,scenarios:results.length,results,sourceHashes},null,2));
 writeFileSync('traces.json',JSON.stringify(traces,null,2));process.stdout.write(`RESULT ${results.length} scenarios / ${checks} checks\n`);
}finally{await stop();await db.end();}
