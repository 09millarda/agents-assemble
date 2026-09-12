// THROWAWAY architecture experiment. Destructively resets only the dedicated experiment DB.
import { Client } from 'pg';
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.env.PGDATABASE, 'aa_experiment');
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.match(process.env.AA_EXPERIMENT_CONTAINER ?? '', /^aa-durable-/);
const contexts = ['execution', 'human', 'knowledge', 'integrations', 'provider'];
let admin;
async function connect() { admin = new Client({ user: 'postgres' }); await admin.connect(); }
await connect();
const databaseVersion = (await admin.query('select version()')).rows[0].version;
for (const c of contexts) {
  await admin.query(`DROP SCHEMA IF EXISTS ${c} CASCADE`);
  if (!(await admin.query('select 1 from pg_roles where rolname=$1', [`aa_${c}`])).rowCount)
    await admin.query(`CREATE ROLE aa_${c} LOGIN PASSWORD 'throwaway'`);
  await admin.query(`CREATE SCHEMA ${c} AUTHORIZATION aa_${c}`);
  await admin.query(`SET ROLE aa_${c}`);
  await admin.query(`CREATE TABLE ${c}.records(id text PRIMARY KEY,state jsonb NOT NULL);
    CREATE TABLE ${c}.inbox(id text PRIMARY KEY,payload jsonb NOT NULL,outcome jsonb);
    CREATE TABLE ${c}.outbox(id text PRIMARY KEY,recipient text NOT NULL,payload jsonb NOT NULL,delivered boolean NOT NULL DEFAULT false)`);
  await admin.query('RESET ROLE');
}
let serial=0, assertions=0, scenario, events=[];
const results=[];
const check=(value, message)=>{ assertions++; assert.ok(value,message); };
const equal=(a,b,message)=>{assertions++; assert.deepEqual(a,b,message);};
async function reset(){for(const c of contexts) await admin.query(`TRUNCATE ${c}.records,${c}.inbox,${c}.outbox`);}
async function snapshot(){const s={};for(const c of contexts){s[c]={};for(const t of ['records','inbox','outbox'])s[c][t]=await rows(c,t);}return s;}
async function state(c,r){return (await admin.query(`SELECT state FROM ${c}.records WHERE id=$1`,[r])).rows[0]?.state;}
async function rows(c,table){return (await admin.query(`SELECT * FROM ${c}.${table} ORDER BY id`)).rows;}
async function call(context,op,args={},crash){
  const command={context,id:`cmd-${++serial}`,op,run:'r',...args,...(crash?{crash}:{})};
  const result=await new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,['worker.mjs',JSON.stringify(command)],{env:process.env});
    let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);
    p.on('exit',(code,signal)=>{
      if(signal==='SIGKILL') resolve({crashed:true,signal});
      else if(code!==0) reject(new Error(`worker ${op} failed (${code}): ${err}\n${out}`));
      else {try{resolve(JSON.parse(out));}catch(e){reject(new Error(`${op}: ${out}\n${err}`));}}
    });
  });
  events.push({scenario,command,result,snapshot:await snapshot()});
  return result;
}
async function good(context,op,args={}){const r=await call(context,op,args);check(r.ok,`${op}: ${JSON.stringify(r)}`);return r;}
async function bad(context,op,args={}){const r=await call(context,op,args);check(r.ok===false,`${op} must reject: ${JSON.stringify(r)}`);return r;}
async function admit(args={}){return good('execution','admit',{limit:4,maxAttempts:4,manifest:'scope:v1',spec:'spec:v1',deliveryId:'change:1',...args});}
async function deliver(source,entry,{crash,ack=true}={}){
  const r=await call(entry.recipient,entry.payload.op,{...entry.payload,id:entry.id},crash);
  // Transport fixture acknowledges only after delivery. A recipient crash after commit leaves this row pending.
  if(!r.crashed && ack) await relayAck(source,entry.id);
  return r;
}
async function relayAck(context,id){
  // Separate producer-owned connection; never joins recipient transaction.
  const db=new Client({user:`aa_${context}`});await db.connect();
  await db.query(`UPDATE ${context}.outbox SET delivered=true WHERE id=$1`,[id]);await db.end();
}
async function pending(c){return (await rows(c,'outbox')).filter(x=>!x.delivered);}
async function test(name,fn){
  scenario=name;await reset();const before=assertions;
  try{await fn();results.push({name,status:'passed',assertions:assertions-before});console.log(`PASS ${name}`);}
  catch(e){results.push({name,status:'failed',error:e.stack});console.log(`FAIL ${name}: ${e.stack}`);}
}

await test('producer killed before commit rolls back state, inbox and outbox',async()=>{
  const args={id:'admit-crash',limit:2,maxAttempts:2,manifest:'scope:v1',spec:'spec:v1',deliveryId:'change:1'};
  check((await call('execution','admit',args,'beforeCommit')).crashed,'SIGKILL observed');
  equal(await rows('execution','records'),[]);equal(await rows('execution','inbox'),[]);equal(await rows('execution','outbox'),[]);
  await good('execution','admit',args);check(await state('execution','r'),'retry accepted');
});
await test('producer killed after commit preserves canonical result and idempotency',async()=>{
  const args={id:'admit-crash',limit:2,maxAttempts:2,manifest:'scope:v1',spec:'spec:v1',deliveryId:'change:1'};
  check((await call('execution','admit',args,'afterCommit')).crashed);
  const before=await state('execution','r');check(before);
  await good('execution','admit',args);equal(await state('execution','r'),before);
  await bad('execution','admit',{...args,limit:3});equal(await state('execution','r'),before);
});
await test('schema-owner roles forbid cross-context access',async()=>{
  for(const actor of contexts){const db=new Client({user:`aa_${actor}`});await db.connect();
    for(const other of contexts.filter(x=>x!==actor)){
      for(const q of [`SELECT * FROM ${other}.records`,`INSERT INTO ${other}.outbox(id,recipient,payload) VALUES('forged','execution','{}')`]){
        let rejected=false;try{await db.query(q);}catch(e){rejected=e.code==='42501';}check(rejected,`${actor} isolated from ${other}`);
      }
    }await db.end();
  }
});
await test('participant outbox survives producer crash and consumer precommit crash',async()=>{
  await admit();
  check((await call('knowledge','save',{source:'spec',revision:'spec:v2'},'afterCommit')).crashed);
  const [event]=await pending('knowledge');check(event,'producer outbox durable');
  const before=await state('execution','r');
  check((await deliver('knowledge',event,{crash:'beforeCommit'})).crashed);
  equal(await state('execution','r'),before);
  equal((await rows('execution','inbox')).filter(x=>x.id===event.id),[]);
  check((await deliver('knowledge',event)).ok);check((await rows('knowledge','outbox'))[0].delivered);
});
await test('consumer postcommit crash before acknowledgement causes harmless redelivery',async()=>{
  await admit();await good('knowledge','save',{source:'spec',revision:'spec:v2'});
  const [event]=await pending('knowledge');
  check((await deliver('knowledge',event,{crash:'afterCommit'})).crashed);
  equal((await rows('knowledge','outbox'))[0].delivered,false);
  const before=await state('execution','r');
  check((await deliver('knowledge',event)).ok);equal(await state('execution','r'),before);
  equal((await rows('execution','inbox')).filter(x=>x.id===event.id).length,1);
  const changed=await call('execution',event.payload.op,{...event.payload,id:event.id,revision:'different'});
  check(changed.ok===false,'same message ID with different body conflicts');equal(await state('execution','r'),before);
});
await test('concurrent competing assignment commands accept one version',async()=>{
  await admit();const version=(await state('execution','r')).version;
  const rs=await Promise.all([call('execution','acquire',{expectedVersion:version,leaseMs:60000}),call('execution','acquire',{expectedVersion:version,leaseMs:60000})]);
  equal(rs.filter(x=>x.ok).length,1);equal(rs.filter(x=>x.ok===false).length,1);
});
await test('concurrent duplicate commands charge one invocation',async()=>{
  await admit();const args={id:'same-acquire',expectedVersion:(await state('execution','r')).version,leaseMs:60000};
  const rs=await Promise.all([call('execution','acquire',args),call('execution','acquire',args)]);
  check(rs.every(x=>x.ok));equal(rs[0],rs[1]);equal((await rows('execution','inbox')).filter(x=>x.id==='same-acquire').length,1);
});

async function approve(run='r',manifest){
  manifest ??= (await state('execution',run)).manifest;
  const deadline=Date.now()+60000;
  const gate=await good('execution','openWait',{run,manifest,deadline});
  await good('human','open',{run,requestId:gate.requestId,manifest,deadline,expectedVersion:gate.expectedVersion,authorizedActors:['owner']});
  await good('human','respond',{run,requestId:gate.requestId,actor:'owner',decision:'approve'});
  const event=(await pending('human')).find(x=>x.payload.run===run);
  check((await deliver('human',event)).ok);
}
async function publication(run='r'){
  await approve(run);
  const accepted=await good('execution','requestPublication',{run});
  const event=(await pending('execution')).find(x=>x.id===accepted.outboxId);
  check((await deliver('execution',event)).ok);
  await good('integrations','beginEffect',{run,effectId:accepted.effectId});
  return accepted;
}
async function reconcile(accepted,run='r'){
  const found=await good('provider','query',{run,effectId:accepted.effectId});
  equal(found.status,'confirmed');
  const recorded=await good('integrations','recordReceipt',{run,effectId:accepted.effectId,receipt:found.receipt});
  const event=(await pending('integrations')).find(x=>x.id===recorded.outboxId);
  check((await deliver('integrations',event)).ok);return found.receipt;
}
await test('accepted fan-out membership and wait survive process restart without a writer',async()=>{
  await admit();await good('execution','freezeMembership',{members:['b','a']});
  await good('execution','openWait',{manifest:'scope:v1',deadline:Date.now()+60000});
  const before=await state('execution','r');
  equal((await good('execution','snapshot')).state,before);
  equal(before.members,['b','a']);equal(before.writer,null);equal(before.work,1);
  await bad('execution','freezeMembership',{members:['a','b','c']});
  await bad('execution','acquire',{expectedVersion:before.version,leaseMs:1000});
  equal(await state('execution','r'),before);
});
await test('invalid membership does not partially commit or spend work',async()=>{
  await admit();const before=await state('execution','r');
  await bad('execution','freezeMembership',{members:['same','same']});
  await bad('execution','freezeMembership',{members:Array.from({length:101},(_,i)=>String(i))});
  equal(await state('execution','r'),before);
});
await test('human acceptance remains pending until Execution accepts its own inbox',async()=>{
  await admit();const deadline=Date.now()+60000;
  const gate=await good('execution','openWait',{manifest:'scope:v1',deadline});
  await good('human','open',{requestId:gate.requestId,manifest:'scope:v1',deadline,expectedVersion:gate.expectedVersion,authorizedActors:['owner']});
  await bad('human','respond',{requestId:gate.requestId,actor:'stranger',decision:'approve'});
  await good('human','respond',{id:'reply',requestId:gate.requestId,actor:'owner',decision:'approve'});
  equal((await state('execution','r')).approvals,[]);
  const event=(await pending('human'))[0];check((await deliver('human',event,{crash:'afterCommit'})).crashed);
  const before=await state('execution','r');equal(before.approvals.length,1);
  check((await deliver('human',event)).ok);equal(await state('execution','r'),before);
  await bad('human','respond',{id:'reply',requestId:gate.requestId,actor:'owner',decision:'deny'});
});
await test('observed edit before reply rejects the stale Execution approval',async()=>{
  await admit();const deadline=Date.now()+60000;
  const gate=await good('execution','openWait',{manifest:'scope:v1',deadline});
  await good('human','open',{requestId:gate.requestId,manifest:'scope:v1',deadline,expectedVersion:gate.expectedVersion,authorizedActors:['owner']});
  await good('human','respond',{requestId:gate.requestId,actor:'owner',decision:'approve'});
  await good('knowledge','save',{source:'spec',revision:'spec:v2'});
  check((await deliver('knowledge',(await pending('knowledge'))[0])).ok);
  check((await deliver('human',(await pending('human'))[0])).ok===false);
  equal((await state('execution','r')).approvals,[]);check((await state('execution','r')).flags.edits);
  await bad('execution','requestPublication');
});
await test('reply before edit remains auditable while observation pauses publication; retain preserves scope',async()=>{
  await admit();await approve();const approvals=(await state('execution','r')).approvals;
  await good('knowledge','save',{source:'spec',revision:'spec:v2'});
  check((await deliver('knowledge',(await pending('knowledge'))[0])).ok);
  await bad('execution','requestPublication');
  await good('execution','retain',{source:'spec',seq:1,revision:'spec:v2',expectedVersion:(await state('execution','r')).version});
  equal((await state('execution','r')).approvals,approvals);equal((await state('execution','r')).spec,'spec:v1');
  await good('execution','requestPublication');
});
await test('expired wait persists expiry and never produces approval',async()=>{
  await admit();await good('execution','openWait',{manifest:'scope:v1',deadline:Date.now()+700});
  await bad('execution','expireWait');await delay(750);
  const before=await state('execution','r');
  await bad('execution','humanResponse',{requestId:before.wait.requestId,manifest:'scope:v1',expectedVersion:before.wait.version,decision:'approve',responseId:'late'});
  await good('execution','expireWait');
  equal((await state('execution','r')).approvals,[]);
  await bad('execution','requestPublication');
});
await test('out-of-order observations retain newest revision and require independent gap reconciliation',async()=>{
  await admit();await good('execution','observeEdit',{source:'spec',seq:3,revision:'opaque:A'});
  await bad('execution','observeEdit',{source:'spec',seq:2,revision:'opaque:Z'});
  equal((await state('execution','r')).observed.spec,{seq:3,revision:'opaque:A'});
  await good('execution','retain',{source:'spec',seq:3,revision:'opaque:A',expectedVersion:(await state('execution','r')).version});
  check((await state('execution','r')).flags.gap);equal((await state('execution','r')).flags.edits,false);
  await bad('execution','acquire',{expectedVersion:(await state('execution','r')).version,leaseMs:1000});
  await bad('execution','reconcileGap',{source:'spec',seq:3,revision:'opaque:A',authoritative:false});
  await good('execution','reconcileGap',{source:'spec',seq:3,revision:'opaque:A',authoritative:true});
  await good('execution','observeEdit',{source:'spec',seq:3,revision:'opaque:A'});
  equal((await state('execution','r')).flags.edits,false);equal((await state('execution','r')).flags.gap,false);
});
await test('stopped writer retain requires verified reconstruction and one charged replacement invocation',async()=>{
  await admit();await good('execution','acquire',{expectedVersion:0,leaseMs:60000});
  await good('execution','observeEdit',{source:'spec',seq:1,revision:'spec:v2'});await good('execution','stopWriter',{generation:1});
  await good('execution','retain',{source:'spec',seq:1,revision:'spec:v2',expectedVersion:(await state('execution','r')).version});
  check((await state('execution','r')).flags.workspace);
  await bad('execution','acquire',{expectedVersion:(await state('execution','r')).version,leaseMs:60000});
  await bad('execution','reconstruct',{verified:true,pinnedSpec:'spec:wrong',recoveryClass:'verified-checkpoint'});
  await good('execution','reconstruct',{verified:true,pinnedSpec:'spec:v1',recoveryClass:'verified-checkpoint'});
  equal((await state('execution','r')).work,1);
  await good('execution','acquire',{expectedVersion:(await state('execution','r')).version,leaseMs:60000});
  equal((await state('execution','r')).work,2);equal((await state('execution','r')).attempts,2);
});
await test('expired leases and replaced generations reject late results',async()=>{
  await admit();const old=await good('execution','acquire',{expectedVersion:0,leaseMs:200});await delay(230);
  await bad('execution','complete',{generation:old.generation});
  await good('execution','stopWriter',{generation:old.generation});await good('execution','reconstruct',{verified:true,pinnedSpec:'spec:v1',recoveryClass:'verified-checkpoint'});
  const replacement=await good('execution','acquire',{expectedVersion:(await state('execution','r')).version,leaseMs:60000});
  await bad('execution','complete',{generation:old.generation});
  await bad('execution','stopWriter',{generation:old.generation});
  await good('execution','complete',{generation:replacement.generation});
  equal((await state('execution','r')).completions,[{generation:replacement.generation}]);
});
await test('persisted retry time blocks early work and attempts never exceed admission',async()=>{
  await admit({limit:2,maxAttempts:2});let a=await good('execution','acquire',{expectedVersion:0,leaseMs:60000});
  await good('execution','complete',{generation:a.generation});
  const dueAt=Date.now()+3000;
  await good('execution','scheduleRetry',{dueAt});
  await bad('execution','acquire',{expectedVersion:(await state('execution','r')).version,leaseMs:60000});
  await bad('execution','fireRetry',{expectedVersion:(await state('execution','r')).version,leaseMs:60000});await delay(Math.max(0,dueAt-Date.now()+50));
  a=await good('execution','fireRetry',{expectedVersion:(await state('execution','r')).version,leaseMs:60000});
  await good('execution','complete',{generation:a.generation});
  await good('execution','scheduleRetry',{dueAt:Date.now()-1});
  await bad('execution','fireRetry',{expectedVersion:(await state('execution','r')).version,leaseMs:60000});
  equal((await state('execution','r')).work,2);equal((await state('execution','r')).attempts,2);
});

await test('edit then retain reissues a wait with fresh identity and needs a new human answer',async()=>{
  await admit();const deadline=Date.now()+60000;
  const gate=await good('execution','openWait',{manifest:'scope:v1',deadline});
  await good('human','open',{requestId:gate.requestId,manifest:'scope:v1',deadline,expectedVersion:gate.expectedVersion,authorizedActors:['owner']});
  await good('human','respond',{requestId:gate.requestId,actor:'owner',decision:'approve'});
  const oldReply=(await pending('human'))[0];
  await good('execution','observeEdit',{source:'spec',seq:1,revision:'spec:v2'});
  check((await deliver('human',oldReply)).ok===false);
  await good('execution','retain',{source:'spec',seq:1,revision:'spec:v2',expectedVersion:(await state('execution','r')).version});
  const fresh=await good('execution','reissueWait',{expectedVersion:(await state('execution','r')).version,deadline});
  check(fresh.requestId!==gate.requestId);equal((await state('execution','r')).waitHistory[0].requestId,gate.requestId);
  check((await deliver('human',oldReply)).ok===false);equal((await state('execution','r')).approvals,[]);
  await good('human','open',{requestId:fresh.requestId,manifest:'scope:v1',deadline,expectedVersion:fresh.expectedVersion,authorizedActors:['owner']});
  await good('human','respond',{requestId:fresh.requestId,actor:'owner',decision:'approve'});
  check((await deliver('human',(await pending('human')).find(x=>x.payload.requestId===fresh.requestId))).ok);
  equal((await state('execution','r')).approvals.length,1);equal((await state('execution','r')).work,2);
  equal((await rows('human','records')).length,2);
});
await test('active writer cannot open a human wait or borrow an undeclared recovery class',async()=>{
  await admit();await good('execution','acquire',{expectedVersion:0,leaseMs:60000});
  await bad('execution','openWait',{manifest:'scope:v1',deadline:Date.now()+60000});
  await good('execution','stopWriter',{generation:1});
  await bad('execution','reconstruct',{verified:true,pinnedSpec:'spec:v1',recoveryClass:'arbitrary-retry'});
  check((await state('execution','r')).flags.workspace);
});
await test('shared work allowance bounds human and publication admissions',async()=>{
  await admit({limit:1});await approve();equal((await state('execution','r')).work,1);
  await bad('execution','requestPublication');equal((await state('execution','r')).work,1);
  equal(await pending('execution'),[]);
});
await test('same rejected command stays rejected after state changes',async()=>{
  await admit();const initial=await bad('execution','requestPublication',{id:'too-early'});
  await approve();equal(await bad('execution','requestPublication',{id:'too-early'}),initial);
  await good('execution','requestPublication');
});
await test('publication success before receipt survives crashes on both receipt boundaries',async()=>{
  await admit();const accepted=await publication();
  check((await call('provider','createOrUpdate',{effectId:accepted.effectId,deliveryId:accepted.deliveryId},'afterCommit')).crashed);
  equal((await state('integrations','r')).effects[accepted.effectId].status,'unknown');
  check((await state('execution','r')).flags.effect);
  const found=await good('provider','query',{effectId:accepted.effectId});equal(found.status,'confirmed');
  const args={id:'receipt-crash',effectId:accepted.effectId,receipt:found.receipt};
  check((await call('integrations','recordReceipt',args,'beforeCommit')).crashed);
  equal((await state('integrations','r')).effects[accepted.effectId].status,'unknown');equal(await pending('integrations'),[]);
  check((await call('integrations','recordReceipt',args,'afterCommit')).crashed);
  equal((await state('integrations','r')).effects[accepted.effectId].status,'confirmed');check((await state('execution','r')).flags.effect);
  await good('integrations','recordReceipt',args);
  const [event]=await pending('integrations');check((await deliver('integrations',event)).ok);check((await deliver('integrations',event)).ok);
  equal((await state('execution','r')).flags.effect,false);
  const deliveries=(await rows('provider','records')).filter(x=>x.id.startsWith('delivery:'));
  equal(deliveries.length,1);equal(deliveries[0].state.updates,1);
});
await test('lost begin acknowledgement and missing provider receipt never reauthorize a call',async()=>{
  await admit();await approve();const accepted=await good('execution','requestPublication');
  check((await deliver('execution',(await pending('execution'))[0])).ok);
  const args={id:'begin-lost',effectId:accepted.effectId};
  check((await call('integrations','beginEffect',args,'afterCommit')).crashed);
  const replay=await good('integrations','beginEffect',args);equal(replay.callPermitted,false);equal(replay.replayed,true);
  await bad('integrations','beginEffect',{effectId:accepted.effectId});
  equal((await good('provider','query',{effectId:accepted.effectId})).status,'not_found');
  equal((await state('integrations','r')).effects[accepted.effectId].status,'unknown');check((await state('execution','r')).flags.effect);
});
await test('concurrent duplicate begin commands expose one first-dispatch hint',async()=>{
  await admit();await approve();const accepted=await good('execution','requestPublication');
  check((await deliver('execution',(await pending('execution'))[0])).ok);
  const args={id:'same-begin',effectId:accepted.effectId};
  const rs=await Promise.all([call('integrations','beginEffect',args),call('integrations','beginEffect',args)]);
  equal(rs.filter(x=>x.callPermitted===true).length,1);equal(rs.filter(x=>x.callPermitted===false).length,1);
});
await test('expired accepted grant cannot start external publication',async()=>{
  await admit();await approve();const accepted=await good('execution','requestPublication',{grantExpiresAt:Date.now()+700});
  check((await deliver('execution',(await pending('execution'))[0])).ok);await delay(750);
  const rejected=await bad('integrations','beginEffect',{effectId:accepted.effectId});equal(rejected.error,'grant_expired');
  equal(await rows('provider','records'),[]);check((await state('execution','r')).flags.effect);
});
await test('cancel after intent issuance preserves the accepted effect obligation and independent gap',async()=>{
  await admit();await approve();const accepted=await good('execution','requestPublication');
  await good('execution','cancel');await bad('execution','settleCancellation');await bad('execution','requestPublication');
  check((await deliver('execution',(await pending('execution'))[0])).ok);
  await good('integrations','beginEffect',{effectId:accepted.effectId});
  await good('provider','createOrUpdate',{effectId:accepted.effectId,deliveryId:accepted.deliveryId});
  await good('execution','observeEdit',{source:'spec',seq:3,revision:'spec:v3'});
  await reconcile(accepted);
  const after=await state('execution','r');equal(after.flags.effect,false);check(after.flags.cancel);check(after.flags.gap);check(after.flags.edits);
  await good('execution','settleCancellation');check((await state('execution','r')).flags.gap);
  await bad('execution','successor',{newRun:'next',admission:{limit:4,maxAttempts:4,manifest:'scope:v1',spec:'spec:v3'}});
});
await test('successor needs explicit admission, preserves delivery mapping and inherits no approvals or work',async()=>{
  await admit();const accepted=await publication();
  await bad('execution','successor',{newRun:'next',admission:{limit:4,maxAttempts:4,manifest:'scope:v1',spec:'spec:v2'}});
  await good('provider','createOrUpdate',{effectId:accepted.effectId,deliveryId:accepted.deliveryId});await reconcile(accepted);
  await good('execution','observeEdit',{source:'spec',seq:1,revision:'spec:v2'});
  await bad('execution','successor',{newRun:'next'});
  await good('execution','successor',{newRun:'next',admission:{limit:4,maxAttempts:4,manifest:'scope:v1',spec:'spec:v2'},adopt:{source:'spec',seq:1,revision:'spec:v2'}});
  const next=await state('execution','next');equal(next.work,0);equal(next.attempts,0);equal(next.approvals,[]);equal(next.completions,[]);equal(next.deliveryId,accepted.deliveryId);
  const successor=await publication('next');check(successor.effectId!==accepted.effectId);
  await good('provider','createOrUpdate',{run:'next',effectId:successor.effectId,deliveryId:successor.deliveryId});await reconcile(successor,'next');
  const deliveries=(await rows('provider','records')).filter(x=>x.id.startsWith('delivery:'));
  equal(deliveries.length,1);equal(deliveries[0].state.updates,2);
});
await test('database SIGKILL and restart preserve waits, membership, retry deadlines, budgets and outboxes',async()=>{
  await admit();await good('execution','freezeMembership',{members:['one','two']});
  await good('execution','scheduleRetry',{dueAt:Date.now()+60000});
  await good('execution','openWait',{manifest:'scope:v1',deadline:Date.now()+60000});
  await good('knowledge','save',{source:'spec',revision:'spec:v2'});
  const before=await snapshot();await admin.end();
  execFileSync('docker',['kill','--signal=KILL',process.env.AA_EXPERIMENT_CONTAINER]);
  execFileSync('docker',['start',process.env.AA_EXPERIMENT_CONTAINER]);
  process.env.PGPORT=execFileSync('docker',['port',process.env.AA_EXPERIMENT_CONTAINER,'5432/tcp'],{encoding:'utf8'}).trim().split(':').pop();
  let connected=false;
  for(let n=0;n<60;n++){try{await connect();connected=true;break;}catch{await delay(100);}}
  check(connected,'PostgreSQL returned after SIGKILL');equal(await snapshot(),before);
  equal((await state('execution','r')).approvals,[]);equal((await state('execution','r')).writer,null);
  check((await deliver('knowledge',(await pending('knowledge'))[0])).ok);
  events.push({scenario,command:{op:'database-restart'},result:{ok:true},snapshot:await snapshot()});
});

const report={throwaway:true,date:new Date().toISOString(),node:process.version,databaseVersion,results,assertions,
  passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length};
writeFileSync('results.json',JSON.stringify(report,null,2)+'\n');
writeFileSync('traces.json',JSON.stringify(events,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:report.failed,assertions}));
await admin.end();
if(report.failed) process.exitCode=1;
