// Live signed GitHub token; controlled accepted approval, co-resident gate, no AWS calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { verify,startGate,worker } from './gate.mjs';
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const db=new pg.Client();await db.connect();
await db.query(readFileSync('schema.sql','utf8'));
const policy={audience:`urn:agents-assemble:decision-15:claim:${randomUUID()}`,workflowSha:process.env.GITHUB_SHA,
  runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT};
async function mint(audience){
  const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);url.searchParams.set('audience',audience);
  const response=await fetch(url,{headers:{Authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});
  if(!response.ok) throw Error('OIDC-issuer-failed');
  return (await response.json()).value;
}
const token=await mint(policy.audience);
const wrongAudience=await mint(policy.audience+'-other');
const claims=await verify(token,policy);
const checks=[];
const pass=name=>checks.push({name,passed:true});
pass('real token signature, issuer, audience, time and exact execution policy verified');
for(const override of [{repository_id:'other'},{repository_owner_id:'other'},{workflow_sha:'other'},
  {workflow_ref:'other'},{ref:'refs/heads/untrusted'},{run_id:'other'},{run_attempt:'999'}]) {
  await assert.rejects(verify(token,{...policy,override}));
}
pass('valid signed token rejected by mismatched repository, owner, workflow, ref, run or attempt policy');
const manifest={artifact:'fixture-sha256',artifact_version:'fixture-immutable-version',environment:'fixture-prod',environment_generation:0,
  configuration:{mode:'test'},workflow_revision:policy.workflowSha,expected_prior:'fixture-prior',staging_receipt:'seeded-verified-staging',
  rollback_target:{artifact:'fixture-prior'},health_policy:'fixture-health',rollback_policy:'fixture-rollback'};
for(const id of ['approved','revoked','wrong-workflow']){
  await db.query('INSERT INTO execution.environments(id,current_release) VALUES($1,$2)',[id,'fixture-prior']);
  const m={...manifest,environment:id,...(id==='wrong-workflow'?{workflow_revision:'different-approved-workflow'}:{})};
  await db.query(`INSERT INTO execution.effects(id,env,manifest,digest,expected_prior,kind,expires_at,rollback_until)
    VALUES($1,$1,$2,$3,'fixture-prior','deploy',clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes')`,[id,m,digest(m)]);
}
const gate=await startGate(policy);
const approved={effect:'approved',digest:digest({...manifest,environment:'approved'})};
async function call(bearer,body){
  const response=await fetch(gate.url,{method:'POST',headers:{'Content-Type':'application/json',...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
assert.equal((await call(null,approved)).status,401);
assert.equal((await call(wrongAudience,approved)).status,401);
const parts=token.split('.');
const forged=JSON.parse(Buffer.from(parts[1],'base64url'));forged.run_id='forged-run';
const tampered=[parts[0],Buffer.from(JSON.stringify(forged)).toString('base64url'),parts[2]].join('.');
assert.equal((await call(tampered,approved)).status,401);
pass('HTTP gate denies absent token, real wrong-audience token and tampered signed payload');
assert.equal((await call(token,{...approved,digest:'0'.repeat(64)})).status,409);
assert.equal((await call(token,{...approved,run:'caller-selected-run'})).status,400);
assert.equal((await db.query("SELECT state FROM execution.effects WHERE id='approved'")).rows[0].state,'approved');
pass('changed manifest digest and caller-selected identity rejected without consuming authority');
const wrongWorkflow={...manifest,environment:'wrong-workflow',workflow_revision:'different-approved-workflow'};
assert.equal((await call(token,{effect:'wrong-workflow',digest:digest(wrongWorkflow)})).body.error,'effect-workflow-mismatch');
assert.equal((await db.query("SELECT state FROM execution.effects WHERE id='wrong-workflow'")).rows[0].state,'approved');
pass('authenticated job cannot claim an effect approved for a different workflow revision');
const concurrent=await Promise.all([call(token,approved),call(token,approved)]);
assert.deepEqual(concurrent.map(x=>x.status).sort(),[201,409]);
assert.equal((await call(token,approved)).status,409);
const effect=(await db.query("SELECT * FROM execution.effects WHERE id='approved'")).rows[0];
assert.equal(effect.claim_run,claims.run_id);assert.equal(effect.claim_attempt,Number(claims.run_attempt));
assert.equal((await db.query('SELECT count(*)::int AS n FROM execution.outbox')).rows[0].n,1);
pass('two HTTP requests admit one durable claim; token replay cannot consume authority again');
await worker({context:'execution',op:'revoke',id:'revoked',env:'revoked'});
assert.equal((await call(token,{effect:'revoked',digest:digest({...manifest,environment:'revoked'})})).body.reason,'authority-closed');
pass('valid authenticated job cannot claim revoked authority');
const observations=gate.observations;await gate.close();
const snapshot={};for(const table of ['environments','effects','inbox','outbox','journal']) snapshot[table]=(await db.query(`SELECT * FROM execution.${table} ORDER BY id`)).rows;
const result={evidence_class:'actual-github-oidc-with-controlled-co-resident-claim-gate',runtime:process.version,claims,checks,observations,snapshot,
  source_sha256:Object.fromEntries(['gate.mjs','probe.mjs','schema.sql','package-lock.json','../deployment-authority/worker.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),
  limitations:['Accepted approval and staging receipt are seeded, not an authenticated human decision',
    'Client, verifier and PostgreSQL share one trusted workflow host; no hostile-workload/process isolation claim',
    'No AWS authority, provider operation, automatic restoration or cross-host gateway exercised',
    'Token expiry is checked by jose; actual expiration while waiting/key-rotation faults not exercised']};
await db.end();
// Only allowlisted claims/results leave memory. Never print bearer/request tokens or JWTs.
console.log('AA_OIDC_RESULT='+JSON.stringify(result));
