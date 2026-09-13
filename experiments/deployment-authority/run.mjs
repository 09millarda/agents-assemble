// THROWAWAY fault experiment. Real PostgreSQL/processes; seeded authority and fabricated AWS observations.
import pg from 'pg';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const db = new pg.Client();
await db.connect();
const q = async (s, args=[]) => (await db.query(s, args)).rows;
const canonical = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const hash = x => createHash('sha256').update(canonical(x)).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
await q(`
  CREATE ROLE aa_execution LOGIN PASSWORD 'throwaway';
  CREATE ROLE aa_integrations LOGIN PASSWORD 'throwaway';
  CREATE SCHEMA execution AUTHORIZATION aa_execution;
  CREATE SCHEMA integrations AUTHORIZATION aa_integrations;
  SET ROLE aa_execution;
  CREATE TABLE execution.environments(id text PRIMARY KEY, owner text, current_release text NOT NULL, generation int NOT NULL DEFAULT 0, hold boolean NOT NULL DEFAULT false);
  CREATE TABLE execution.effects(id text PRIMARY KEY, env text NOT NULL, manifest jsonb NOT NULL, digest text NOT NULL,
    expected_prior text NOT NULL, kind text NOT NULL, parent text, expires_at timestamptz NOT NULL, rollback_until timestamptz NOT NULL,
    revoked boolean NOT NULL DEFAULT false, canceled boolean NOT NULL DEFAULT false, allow_rollback boolean NOT NULL DEFAULT true,
    state text NOT NULL DEFAULT 'approved', claim_run text, claim_attempt int, consumed_at timestamptz, receipt jsonb);
  CREATE TABLE execution.inbox(id text PRIMARY KEY, digest text NOT NULL, payload jsonb NOT NULL, verdict text NOT NULL);
  CREATE TABLE execution.outbox(id text PRIMARY KEY, payload jsonb NOT NULL);
  CREATE TABLE execution.journal(id bigserial PRIMARY KEY, command jsonb NOT NULL, result jsonb NOT NULL);
  RESET ROLE; SET ROLE aa_integrations;
  CREATE TABLE integrations.intents(id text PRIMARY KEY, digest text NOT NULL, state text NOT NULL);
  CREATE TABLE integrations.receipts(id text PRIMARY KEY, payload jsonb NOT NULL);
  CREATE TABLE integrations.outbox(id text PRIMARY KEY, payload jsonb NOT NULL);
  CREATE TABLE integrations.journal(id bigserial PRIMARY KEY, command jsonb NOT NULL, result jsonb NOT NULL);
  RESET ROLE;
`);
const tables = ['execution.environments','execution.effects','execution.inbox','execution.outbox','execution.journal','integrations.intents','integrations.receipts','integrations.outbox','integrations.journal'];
const traces = [];
const checks = [];
async function snapshot() {
  return Object.fromEntries(await Promise.all(tables.map(async t => [t,await q(`SELECT * FROM ${t} ORDER BY id`)])));
}
async function command(c) {
  const outcome = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['worker.mjs', JSON.stringify(c)]);
    let output = '', error = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => error += chunk);
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({code,signal,output:output ? JSON.parse(output) : null,error}));
  });
  assert.equal(outcome.error, '');
  traces.push({command:c, outcome, snapshot:await snapshot()});
  return outcome;
}
async function expect(c, verdict, reason) {
  const r = await command(c);
  assert.equal(r.code,0);
  assert.equal(r.output.verdict,verdict);
  if (reason) assert.equal(r.output.reason,reason);
  return r.output;
}
function pass(name) { checks.push({name,passed:true}); console.log('PASS', name); }
const manifest = env => ({tenant:'fixture-tenant', project:'agents-assemble', repository_id:'1366483946',
  merged_commit:'fixture-merged-commit', build_revision:'fixture-build-revision', artifact:'healthy-B', artifact_version:'immutable-object-v2',
  template_digest:'template-sha', account:'728616601473', region:'eu-west-1', environment:env, environment_revision:3, environment_generation:0,
  alias:'live', configuration:{mode:'prod',secret_version:null}, workflow_revision:'87be475fd628e1f5bb58ce06c55e9616168679ac',
  expected_prior:'healthy-A', health_policy:'health-v1', rollback_policy:'restore-A-v1', staging_receipt:'staging-verified-B',
  rollback_target:{artifact:'healthy-A',artifact_version:'immutable-object-v1',template_digest:'template-A',configuration:{mode:'prod',secret_version:null}}});
async function seed(id, env=id, overrides={}) {
  await q('INSERT INTO execution.environments(id,current_release) VALUES($1,$2) ON CONFLICT DO NOTHING', [env,'healthy-A']);
  const generation = (await q('SELECT generation FROM execution.environments WHERE id=$1',[env]))[0].generation;
  const m = {...manifest(env), environment_generation:generation, ...(overrides.manifest ?? {})};
  await q(`INSERT INTO execution.effects(id,env,manifest,digest,expected_prior,kind,parent,expires_at,rollback_until,allow_rollback)
    VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+$8::interval,clock_timestamp()+$9::interval,$10)`,
    [id,env,m,hash(m),m.expected_prior,overrides.kind ?? 'deploy',overrides.parent ?? null,overrides.ttl ?? '10 minutes',overrides.rollback_ttl ?? '10 minutes',overrides.allow_rollback ?? true]);
  return {context:'execution',op:'claim',id,env,manifest:m,run:'fixture-run-1',attempt:1};
}
function receipt(c,id,overrides={}) {
  return {id,effect:c.id,env:c.env,digest:hash(c.manifest),run:c.run,attempt:c.attempt,
    generation:c.manifest.environment_generation+1,observed_artifact:c.manifest.artifact,outcome:'healthy',...overrides};
}
async function deliver(c,r) {
  await expect({context:'integrations',op:'persist-receipt',receipt:r},'receipt-and-outbox-committed');
  return expect({...c,op:'receipt',receipt:r},'accepted');
}

// Model uses the ACTUAL two duplicate GitHub run identities collected separately.
const gh = JSON.parse(readFileSync('evidence/github.json','utf8'));
const ids = gh.dispatches.filter(x => x.response).map(x => String(x.response.workflow_run_id));
assert.equal(ids.length,2);
const duplicate = await seed('duplicate');
const racers = await Promise.all(ids.map(run => command({...duplicate,run})));
assert.equal(racers.filter(x => x.output.verdict === 'claim-admitted').length,1);
assert.equal(racers.filter(x => x.output.reason === 'already-consumed').length,1);
await expect({...duplicate,run:ids[0],attempt:2},'rejected','already-consumed');
pass('concurrent actual run identifiers: one local claim; duplicate and rerun denied');

for (const key of Object.keys(manifest('changed'))) {
  const c = await seed('changed-'+key);
  const altered = {...c.manifest,[key]:typeof c.manifest[key] === 'object' ? {mode:'changed'} : 'changed'};
  await expect({...c,manifest:altered},'rejected','manifest-mismatch');
}
pass('every bound manifest field substitution rejected');

const intent = {context:'integrations',op:'dispatch-intent',id:'lost-dispatch',manifest:manifest('intent')};
assert.equal((await command({...intent,crash_after_commit:true})).signal,'SIGKILL');
await expect(intent,'replay-no-dispatch');
await expect({...intent,manifest:{...intent.manifest,artifact:'different'}},'rejected','payload-conflict');
pass('dispatch intent survives process kill; replay does not authorize redispatch; payload conflict rejected');

for (const op of ['revoke','cancel']) {
  const c = await seed('before-'+op);
  await expect({...c,op},'future-admission-closed');
  await expect(c,'rejected','authority-closed');
}
const expired = await seed('expired','expired',{ttl:'-1 second'});
await expect(expired,'rejected','authority-closed');
pass('expiry, revocation and cancellation before claim deny admission');

const locked = await seed('expiry-under-lock','expiry-under-lock',{ttl:'3 seconds'});
await q('BEGIN');
await q('SELECT * FROM execution.environments WHERE id=$1 FOR UPDATE',[locked.env]);
const waiting = command(locked);
let lockBarrier;
for (let retry=0;retry<100;retry++) {
  await q('SELECT pg_stat_clear_snapshot()');
  lockBarrier = (await q("SELECT application_name,wait_event_type,clock_timestamp() AS observed_at FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[`aa-authority-execution-${locked.id}`]))[0];
  if (lockBarrier) break;
  await pause(20);
}
assert.ok(lockBarrier,'worker must actually reach the database lock wait');
assert.ok(lockBarrier.observed_at < (await q('SELECT expires_at FROM execution.effects WHERE id=$1',[locked.id]))[0].expires_at);
traces.push({barrier:'worker-confirmed-waiting-before-expiry',observation:lockBarrier});
await pause(3100);
await q('COMMIT');
assert.equal((await waiting).output.reason,'authority-closed');
pass('database clock after environment lock rejects approval expired during wait');

const crashed = await seed('claim-crash');
assert.equal((await command({...crashed,crash_after_commit:true})).signal,'SIGKILL');
await expect(crashed,'rejected','already-consumed');
await expect({...crashed,op:'cancel'},'future-admission-closed');
const blocked = await seed('next-after-crash',crashed.env);
await expect(blocked,'rejected','environment-obligation-open');
assert.equal((await q('SELECT owner FROM execution.environments WHERE id=$1',[crashed.env]))[0].owner,crashed.id);
pass('claim process kill and cancellation retain unknown environment obligation');

const after = await seed('after-claim');
await expect(after,'claim-admitted');
await expect({...after,op:'revoke'},'future-admission-closed');
await expect({...after,op:'cancel'},'future-admission-closed');
await q("UPDATE execution.effects SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[after.id]);
await deliver(after,receipt(after,'after-claim-receipt'));
pass('already admitted effect can complete after expiry/revocation/cancel; no fictional remote revocation');

const handoff = await seed('receipt-handoff');
await expect(handoff,'claim-admitted');
const hr = receipt(handoff,'handoff-receipt');
assert.equal((await command({context:'integrations',op:'persist-receipt',receipt:hr,crash_after_commit:true})).signal,'SIGKILL');
await expect({context:'integrations',op:'persist-receipt',receipt:hr},'receipt-replay');
assert.equal((await command({...handoff,op:'receipt',receipt:hr,crash_after_commit:true})).signal,'SIGKILL');
await expect({...handoff,op:'receipt',receipt:hr},'receipt-redelivery');
await expect({...handoff,op:'receipt',receipt:{...hr,outcome:'failed-health'}},'rejected','inbox-payload-conflict');
await expect({...handoff,op:'receipt',receipt:{...hr,id:'late-observation',attempt:0,outcome:'failed-health'}},'rejected-stale-or-conflicting');
assert.equal((await q('SELECT state FROM execution.effects WHERE id=$1',[handoff.id]))[0].state,'succeeded');
assert.equal((await q('SELECT count(*)::int AS n FROM execution.inbox WHERE id=$1',[hr.id]))[0].n,1);
assert.equal((await q("SELECT count(*)::int AS n FROM execution.journal WHERE result->>'reason'='inbox-payload-conflict'"))[0].n,1);
pass('two context-local commit/ack crashes; immutable receipt replay and late conflict cannot redispatch or change success');

const scope = await seed('receipt-scope');
await expect(scope,'claim-admitted');
for (const [key,value] of Object.entries({effect:'other',env:'other',digest:'other',run:'other',attempt:99,generation:99,observed_artifact:'other'})) {
  await expect({...scope,op:'receipt',receipt:receipt(scope,'wrong-'+key,{[key]:value})},'rejected-stale-or-conflicting');
}
pass('cross-effect, environment, manifest, run, attempt, generation and artifact receipts rejected');

const fail = await seed('failed-deploy');
await expect(fail,'claim-admitted');
await deliver(fail,receipt(fail,'failed-health',{outcome:'failed-health'}));
const aba = await seed('stale-A-approval',fail.env,{manifest:{environment_generation:0}});
const wrongTarget = await seed('wrong-restore-config',fail.env,{kind:'rollback',parent:fail.id,manifest:{...fail.manifest.rollback_target,expected_prior:'healthy-B',configuration:{mode:'wrong'}}});
await expect(wrongTarget,'rejected','rollback-target-mismatch');
const rollback = await seed('restore',fail.env,{kind:'rollback',parent:fail.id,manifest:{...fail.manifest.rollback_target,expected_prior:'healthy-B'}});
await expect(rollback,'claim-admitted');
await deliver(rollback,receipt(rollback,'restored'));
assert.equal((await q('SELECT state FROM execution.effects WHERE id=$1',[fail.id]))[0].state,'failed');
assert.equal((await q('SELECT current_release FROM execution.environments WHERE id=$1',[fail.env]))[0].current_release,'healthy-A');
pass('separate authorized restoration restores predecessor and preserves original failed release');
await expect(aba,'rejected','environment-generation-mismatch');
pass('A-to-B-to-A cannot revive stale generation-bound approval; rollback configuration substitution denied');

const no = await seed('no-rollback','no-rollback',{allow_rollback:false});
await expect(no,'claim-admitted');
await deliver(no,receipt(no,'no-health',{outcome:'failed-health'}));
const denied = await seed('denied-restore',no.env,{kind:'rollback',parent:no.id,manifest:{...no.manifest.rollback_target,expected_prior:'healthy-B'}});
await expect(denied,'rejected','rollback-not-authorized');
pass('failed health does not manufacture undeclared restoration authority');

const oldEnvelope = await seed('expired-envelope','expired-envelope',{rollback_ttl:'-1 second'});
await expect(oldEnvelope,'claim-admitted');
await deliver(oldEnvelope,receipt(oldEnvelope,'expired-envelope-health',{outcome:'failed-health'}));
const oldRestore = await seed('expired-envelope-restore',oldEnvelope.env,{kind:'rollback',parent:oldEnvelope.id,manifest:{...oldEnvelope.manifest.rollback_target,expected_prior:'healthy-B'}});
await expect(oldRestore,'rejected','rollback-envelope-expired');
pass('separate rollback claim cannot outlive the finite parent rollback envelope');

const unknown = await seed('before-unknown');
await expect(unknown,'claim-admitted');
await deliver(unknown,receipt(unknown,'unknown-parent-failed',{outcome:'failed-health'}));
const ur = await seed('unknown-rollback',unknown.env,{kind:'rollback',parent:unknown.id,manifest:{...unknown.manifest.rollback_target,expected_prior:'healthy-B'}});
assert.equal((await command({...ur,crash_after_commit:true})).signal,'SIGKILL');
await expect({...ur,op:'cancel'},'future-admission-closed');
await expect(ur,'rejected','already-consumed');
const next = await seed('after-unknown-rollback',ur.env,{manifest:{expected_prior:'healthy-B'}});
await expect(next,'rejected','environment-obligation-open');
pass('uncertain restoration remains owned and blocks newer deployment after cancellation');

const pred = await seed('stale-predecessor','stale-predecessor',{manifest:{expected_prior:'old'}});
await expect(pred,'rejected','predecessor-mismatch');
const hold = await seed('independent-hold');
await q('UPDATE execution.environments SET hold=true WHERE id=$1',[hold.env]);
await expect(hold,'rejected','independent-hold');
pass('stale predecessor and independent recovery hold block claim');

for (const [user,table] of [['aa_execution','integrations.intents'],['aa_integrations','execution.effects']]) {
  const other = new pg.Client({user,password:'throwaway'});
  await other.connect();
  await assert.rejects(other.query(`SELECT * FROM ${table}`),e => e.code === '42501');
  await other.end();
}
pass('database roles prohibit either context from reading the other owner state');

const evidence = {evidence_class:'controlled-postgresql-process-fault-model',
  postgres:(await q('SELECT version() AS version'))[0].version,
  source_sha256:Object.fromEntries(['worker.mjs','run.mjs','run.sh'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),
  github_run_ids:ids,checks,traces,final:await snapshot(),
  limitations:['Seeded accepted approval; no Human Interaction flow or authentic claim endpoint',
    'Run identities imported from real GitHub records; local callers unauthenticated',
    'AWS receipts fabricated; no credentials, provider requests, rollback automation or network fault exercised',
    'Reduced single-tenant fixture and serialization; no production canonical wire format or HA qualification']};
writeFileSync('evidence/protocol.json.gz',gzipSync(JSON.stringify(evidence)));
writeFileSync('evidence/protocol-summary.json',JSON.stringify({...evidence,traces:undefined,final:undefined,transition_count:traces.length},null,2)+'\n');
await db.end();
console.log(`${checks.length} scenario groups passed; full durable snapshots archived`);
