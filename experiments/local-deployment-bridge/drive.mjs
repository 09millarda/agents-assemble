// Local test supervisor/relay. Owner transactions stay separate; killed workers resume original intent.
import {connect,owner,command,digest,wait} from './common.mjs';
import {writeFileSync,appendFileSync} from 'node:fs';
const ex=await connect('execution'),it=await connect('integrations');
const q=async(c,s,a=[])=>(await c.query(s,a)).rows;
const record=x=>appendFileSync('dist/supervisor.jsonl',JSON.stringify({at:new Date().toISOString(),...x})+'\n');
async function relay(){
 for(const out of await q(ex,'SELECT * FROM execution.outbox WHERE delivered=false ORDER BY id')){
  const e=(await q(ex,'SELECT * FROM execution.effects WHERE id=$1',[out.payload.effect]))[0];
  const detail={run:e.claim_run,attempt:e.claim_attempt,permit_expires:e.expires_at};
  await it.query('BEGIN');const old=(await q(it,'SELECT * FROM integrations.intents WHERE id=$1 FOR UPDATE',[e.id]))[0];
  if(old){if(old.digest!==e.digest)throw Error('permit conflict');}
  else await q(it,'INSERT INTO integrations.intents(id,digest,state,manifest,detail) VALUES($1,$2,$3,$4,$5)',[e.id,e.digest,'accepted',e.manifest,detail]);
  await it.query('COMMIT');await q(ex,'UPDATE execution.outbox SET delivered=true WHERE id=$1',[out.id]);
 }
 for(const out of await q(it,'SELECT * FROM integrations.outbox WHERE delivered=false ORDER BY id')){
  const r=out.payload;const accepted=await owner({context:'execution',op:'receipt',id:r.effect,env:r.env,receipt:r});
  if(!['accepted','receipt-redelivery'].includes(accepted.verdict))throw Error('receipt rejected '+JSON.stringify(accepted));
  // Repeat the same acceptance to exercise lost producer acknowledgment without redispatch.
  const replay=await owner({context:'execution',op:'receipt',id:r.effect,env:r.env,receipt:r});if(replay.verdict!=='receipt-redelivery')throw Error('receipt replay failed');
  await q(it,'UPDATE integrations.outbox SET delivered=true WHERE id=$1',[out.id]);record({receipt:r.id,accepted,replay});
 }
}
async function restore(){
 for(const parent of await q(ex,"SELECT * FROM execution.effects WHERE state='failed' AND kind='deploy'")){
  const id=parent.id+'-restore';if((await q(ex,'SELECT id FROM execution.effects WHERE id=$1',[id])).length)continue;
  await ex.query('BEGIN');const env=(await q(ex,'SELECT * FROM execution.environments WHERE id=$1 FOR UPDATE',[parent.env]))[0];
  if(env.owner!==parent.id)throw Error('rollback ownership changed');
  const m={...parent.manifest,...parent.manifest.rollback_target,expected_prior:parent.manifest.artifact,environment_generation:env.generation,
   fault:parent.id==='prod-failure'?'execute':'none'};
  await q(ex,`INSERT INTO execution.effects(id,env,manifest,digest,expected_prior,kind,parent,expires_at,rollback_until)
   VALUES($1,$2,$3,$4,$5,'rollback',$6,$7,$7)`,[id,parent.env,m,digest(m),m.expected_prior,parent.id,parent.rollback_until]);await ex.query('COMMIT');
  const claim=await owner({context:'execution',op:'claim',id,env:parent.env,manifest:m,run:parent.claim_run,attempt:parent.claim_attempt});
  if(claim.verdict!=='claim-admitted')throw Error('rollback claim denied '+JSON.stringify(claim));record({automatic_restoration:id,claim});
 }
}
const start=Date.now();let idle=0;
while(Date.now()-start<45*60*1000){
 await relay();await restore();await relay();
 const pending=await q(it,"SELECT id,state FROM integrations.intents WHERE state NOT IN ('receipted','paused') ORDER BY id LIMIT 1");
 if(!pending.length){idle++;await wait(1000);continue;}
 idle=0;const id=pending[0].id;const result=await command(process.execPath,['provider.mjs',id]);record({worker:id,...result});
 if(result.signal==='SIGKILL'){
  const snapshot={execution:await q(ex,'SELECT * FROM execution.environments ORDER BY id'),intent:(await q(it,'SELECT * FROM integrations.intents WHERE id=$1',[id]))[0]};
  writeFileSync(`dist/crash-${id}.json`,JSON.stringify(snapshot,null,2)+'\n');record({crash_barrier:id,retained_owner:snapshot.execution});
  if(id==='prod-failure-restore'){
   // A controlled contender tests the actual unresolved provider obligation before reconciliation.
   const env=snapshot.execution.find(e=>e.id==='prod');const m={...snapshot.intent.manifest,environment_generation:env.generation,expected_prior:env.current_release};
   await q(ex,`INSERT INTO execution.effects(id,env,manifest,digest,expected_prior,kind,expires_at,rollback_until) VALUES('blocked-contender','prod',$1,$2,$3,'deploy',clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes')`,[m,digest(m),m.expected_prior]);
   await q(ex,"INSERT INTO execution.dispatches VALUES('controlled-contender','blocked-contender',$1,$2)",[digest(m),m.workflow_revision]);
   const denied=await owner({context:'execution',op:'claim',id:'blocked-contender',env:'prod',manifest:m,run:'controlled-contender',attempt:1,authentication_expiry:Date.now()/1000+300});
   if(denied.reason!=='environment-obligation-open')throw Error('contender bypassed obligation');record({controlled_contender:denied});
  }
 }else if(result.code!==0){record({paused:id});}
}
await ex.end();await it.end();
