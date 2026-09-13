// THROWAWAY architecture experiment. Runs only against the dedicated fixture DB.
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const env = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'aa_scope_throwaway',
};
assert.equal(env.database, 'aa_scope_throwaway', 'refuse non-dedicated database');
const admin = new Client({ ...env, user: process.env.PGUSER ?? 'postgres' });
await admin.connect();
const here = fileURLToPath(new URL('.', import.meta.url));
const contexts = ['projects', 'execution', 'integrations'];
let serial = 0;
let assertions = 0;
let scenario = '';
const results = [];
const events = [];
const check = (value, message) => { assertions++; assert.ok(value, message); };
const equal = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
const q = (sql, params = []) => admin.query(sql, params);

async function setup() {
  for (const c of contexts) {
    const role = `aa_${c}`;
    await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} LOGIN; END IF; END $$`);
    await q(`CREATE SCHEMA IF NOT EXISTS ${c}`);
    await q(`ALTER SCHEMA ${c} OWNER TO ${role}`);
  }
  await q(`SET ROLE aa_projects`);
  await q(`CREATE TABLE IF NOT EXISTS projects.inbox(id text PRIMARY KEY, payload_hash text NOT NULL, payload jsonb NOT NULL, outcome jsonb)`);
  await q(`CREATE TABLE IF NOT EXISTS projects.outbox(id text PRIMARY KEY, recipient text NOT NULL, payload jsonb NOT NULL, delivered boolean NOT NULL DEFAULT false)`);
  await q(`CREATE TABLE IF NOT EXISTS projects.project(id text PRIMARY KEY, lifecycle text NOT NULL, policy_epoch integer NOT NULL, suspension_epoch integer NOT NULL, archive_requested_at timestamptz, cutoff_complete boolean NOT NULL DEFAULT false)`);
  await q(`CREATE TABLE IF NOT EXISTS projects.permit(id text PRIMARY KEY, request_id text UNIQUE NOT NULL, run_id text UNIQUE NOT NULL, project_id text NOT NULL, policy_epoch integer NOT NULL, scope_digest text NOT NULL, expires_at timestamptz NOT NULL, status text NOT NULL, verdict jsonb)`);
  await q(`CREATE TABLE IF NOT EXISTS projects.consumer(project_id text NOT NULL, consumer text NOT NULL, ack_epoch integer NOT NULL DEFAULT 0, PRIMARY KEY(project_id, consumer))`);
  await q('RESET ROLE');
  await q(`SET ROLE aa_execution`);
  await q(`CREATE TABLE IF NOT EXISTS execution.inbox(id text PRIMARY KEY, payload_hash text NOT NULL, payload jsonb NOT NULL, outcome jsonb)`);
  await q(`CREATE TABLE IF NOT EXISTS execution.outbox(id text PRIMARY KEY, recipient text NOT NULL, payload jsonb NOT NULL, delivered boolean NOT NULL DEFAULT false)`);
  await q(`CREATE TABLE IF NOT EXISTS execution.candidate(id text PRIMARY KEY, run_id text UNIQUE NOT NULL, project_id text NOT NULL, permit_id text NOT NULL, policy_epoch integer NOT NULL, scope_digest text NOT NULL, expires_at timestamptz NOT NULL, state text NOT NULL, verdict jsonb, budget_charged integer NOT NULL DEFAULT 0, workspace_state text)`);
  await q(`CREATE TABLE IF NOT EXISTS execution.project_gate(project_id text PRIMARY KEY, project_epoch integer NOT NULL, project_hold boolean NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS execution.hold(hold text PRIMARY KEY, active boolean NOT NULL)`);
  await q('RESET ROLE');
  await q(`SET ROLE aa_integrations`);
  await q(`CREATE TABLE IF NOT EXISTS integrations.inbox(id text PRIMARY KEY, payload_hash text NOT NULL, payload jsonb NOT NULL, outcome jsonb)`);
  await q(`CREATE TABLE IF NOT EXISTS integrations.outbox(id text PRIMARY KEY, recipient text NOT NULL, payload jsonb NOT NULL, delivered boolean NOT NULL DEFAULT false)`);
  await q(`CREATE TABLE IF NOT EXISTS integrations.consumer(project_id text PRIMARY KEY, known_epoch integer NOT NULL, installed_epoch integer NOT NULL, ack_epoch integer NOT NULL, cutoff_epoch integer NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS integrations.effect(id text PRIMARY KEY, project_id text NOT NULL, permit_epoch integer NOT NULL, status text NOT NULL)`);
  await q('RESET ROLE');
}

async function reset() {
  for (const c of contexts) await q(`TRUNCATE ${c}.inbox, ${c}.outbox CASCADE`);
  await q('TRUNCATE projects.project, projects.permit, projects.consumer, execution.candidate, execution.project_gate, execution.hold, integrations.consumer, integrations.effect CASCADE');
}

function call(context, op, args = {}, crash) {
  const id = args.id ?? `message:${++serial}`;
  const command = { context, op, id, ...args, ...(crash ? { crash } : {}) };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['worker.mjs', JSON.stringify(command)], {
      cwd: here,
      env: { ...process.env, PGHOST: env.host, PGPORT: String(env.port), PGDATABASE: env.database },
    });
    let output = '';
    let error = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const crashed = signal === 'SIGKILL' || code === 137;
      if (crashed) resolve({ crashed: true, signal, code });
      else if (code !== 0) reject(new Error(`${context}.${op} exited ${code}: ${error}\n${output}`));
      else {
        try { resolve(JSON.parse(output)); }
        catch { reject(new Error(`${context}.${op} returned invalid JSON: ${output}\n${error}`)); }
      }
    });
  }).then((result) => {
    events.push({ scenario, context, op, id, result });
    return result;
  });
}

async function rows(context, table) { return (await q(`SELECT * FROM ${context}.${table} ORDER BY 1`)).rows; }
async function pending(context) { return (await rows(context, 'outbox')).filter((row) => !row.delivered); }
async function ack(context, id) { await q(`UPDATE ${context}.outbox SET delivered = true WHERE id = $1`, [id]); }
async function snapshot() {
  const tables = {
    projects: ['project', 'permit', 'consumer', 'inbox', 'outbox'],
    execution: ['candidate', 'project_gate', 'hold', 'inbox', 'outbox'],
    integrations: ['consumer', 'effect', 'inbox', 'outbox'],
  };
  const result = {};
  for (const [context, names] of Object.entries(tables)) {
    result[context] = {};
    for (const table of names) result[context][table] = await rows(context, table);
  }
  return result;
}
async function run(name, fn) {
  scenario = name;
  await reset();
  const before = assertions;
  try { await fn(); results.push({ name, status: 'passed', assertions: assertions - before, snapshot: await snapshot() }); }
  catch (error) { results.push({ name, status: 'failed', assertions: assertions - before, error: error.stack, snapshot: await snapshot() }); }
}

async function project(id = 'project:1') {
  await call('projects', 'createProject', { id: `create:${id}`, projectId: id });
  await call('projects', 'registerConsumer', { id: `register:execution:${id}`, projectId: id, consumer: 'execution' });
  await call('projects', 'registerConsumer', { id: `register:integrations:${id}`, projectId: id, consumer: 'integrations' });
}
async function permit(projectId = 'project:1', runId = 'run:1', expiresAt = new Date(Date.now() + 60000).toISOString()) {
  const result = await call('projects', 'issuePermit', { id: `issue:${runId}`, requestId: `request:${runId}`, projectId, runId, scopeDigest: `scope:${runId}`, expiresAt });
  const [entry] = await pending('projects');
  check(entry?.payload?.permitId === result.permitId, 'permit outbox names exact permit');
  const received = await call('execution', entry.payload.op, { ...entry.payload, id: entry.id });
  await ack('projects', entry.id);
  check(received.ok, 'execution receives permit');
  return { ...result, expiresAt, scopeDigest: entry.payload.scopeDigest };
}
async function admit(p, id = `admit:${p.runId}`) {
  return call('execution', 'admit', { id, runId: p.runId, permitId: p.permitId, scopeDigest: p.scopeDigest });
}
async function recordPermit(p, verdict) {
  return call('projects', 'recordVerdict', { id: `verdict:${p.runId}:${verdict.status}`, permitId: p.permitId, verdict });
}

await setup();

await run('before-commit crash rolls back permit and outbox', async () => {
  await project();
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const crash = await call('projects', 'issuePermit', { id: 'issue:crash-before', requestId: 'request:crash-before', projectId: 'project:1', runId: 'run:crash-before', scopeDigest: 'scope:crash-before', expiresAt }, 'beforeCommit');
  check(crash.crashed, 'process crash observed');
  equal(await rows('projects', 'permit'), [], 'permit rolled back');
  equal(await pending('projects'), [], 'outbox rolled back');
  const retry = await call('projects', 'issuePermit', { id: 'issue:crash-before', requestId: 'request:crash-before', projectId: 'project:1', runId: 'run:crash-before', scopeDigest: 'scope:crash-before', expiresAt });
  check(retry.ok, 'same request can retry after pre-commit crash');
});

await run('after-commit crash preserves permit and exact replay', async () => {
  await project();
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const args = { id: 'issue:crash-after', requestId: 'request:crash-after', projectId: 'project:1', runId: 'run:crash-after', scopeDigest: 'scope:crash-after', expiresAt };
  check((await call('projects', 'issuePermit', args, 'afterCommit')).crashed, 'post-commit crash observed');
  check((await rows('projects', 'permit')).length === 1, 'committed permit survives');
  const replay = await call('projects', 'issuePermit', args);
  check(replay.replay && replay.permitId === 'permit:run:crash-after', 'replay returns prior result');
  const conflict = await call('projects', 'issuePermit', { ...args, scopeDigest: 'changed' });
  check(conflict.conflict, 'same message ID with changed payload conflicts');
});

await run('archive waits for durable verdict and preserves admitted work', async () => {
  await project();
  const p = await permit();
  const [archived, admitted] = await Promise.all([
    call('projects', 'archive', { id: 'archive:1', projectId: 'project:1' }),
    admit(p),
  ]);
  check(archived.state === 'closing', 'archive enters closing');
  check(admitted.status === 'accepted', 'already-issued permit may admit within expiry');
  const pendingArchive = await call('projects', 'completeArchive', { id: 'complete:pending', projectId: 'project:1' });
  check(pendingArchive.pending, 'temporary absence does not complete archive');
  check((await recordPermit(p, admitted)).status === 'accepted', 'execution verdict reconciles permit');
  check((await call('projects', 'completeArchive', { id: 'complete:accepted', projectId: 'project:1' })).state === 'archived', 'archive completes after verdict');
  const candidate = (await q(`SELECT state, budget_charged FROM execution.candidate WHERE run_id = 'run:1'`)).rows[0];
  equal(candidate, { state: 'accepted', budget_charged: 1 }, 'admission retained after archive');
});

await run('expiry reconciliation closes unused permission without resurrecting it', async () => {
  await project();
  const p = await permit('project:1', 'run:expired', new Date(Date.now() - 1000).toISOString());
  await call('projects', 'archive', { id: 'archive:expired', projectId: 'project:1' });
  const noSilence = await call('projects', 'completeArchive', { id: 'complete:expired-before-reconcile', projectId: 'project:1' });
  check(noSilence.pending, 'expiry alone is not a closure receipt');
  check((await call('projects', 'reconcileExpiry', { id: 'reconcile:expired', permitId: p.permitId })).status === 'expired-unused', 'expiry is durably reconciled');
  check((await call('projects', 'completeArchive', { id: 'complete:expired', projectId: 'project:1' })).state === 'archived', 'archive closes after expiry verdict');
  check((await admit(p)).status === 'expired-unused', 'expired permit cannot admit');
});

await run('workspace failure keeps admission and budget history', async () => {
  await project();
  const p = await permit('project:1', 'run:workspace');
  const admitted = await admit(p);
  check(admitted.status === 'accepted', 'run admitted');
  const failed = await call('execution', 'prepareWorkspace', { id: 'workspace:failure', runId: p.runId, result: 'failed' });
  check(failed.workspace === 'failed' && failed.budgetCharged === 1, 'workspace failure recorded without erasing admission');
  const replay = await admit(p);
  check(replay.replay && replay.budgetCharged === 1, 'exact replay cannot charge a second admission');
  equal((await q(`SELECT state, budget_charged, workspace_state FROM execution.candidate WHERE run_id = 'run:workspace'`)).rows[0], { state: 'accepted', budget_charged: 1, workspace_state: 'failed' }, 'admission and failed preparation both retained');
});

await run('suspension requires checkpoint installation and all consumer acknowledgments', async () => {
  await project();
  const p = await permit('project:1', 'run:suspend');
  await call('integrations', 'enroll', { id: 'enroll:suspend', projectId: 'project:1', epoch: 1 });
  await call('integrations', 'installCheckpoint', { id: 'install:suspend', projectId: 'project:1', epoch: 1 });
  await call('integrations', 'ackCheckpoint', { id: 'ack:suspend', projectId: 'project:1', epoch: 1 });
  const suspension = await call('projects', 'suspend', { id: 'suspend:1', projectId: 'project:1' });
  check(suspension.suspensionEpoch === 2, 'suspension increments policy epoch');
  const projectEvents = await pending('projects');
  for (const entry of projectEvents) {
    const target = entry.recipient;
    const result = await call(target, entry.payload.op, { ...entry.payload, id: entry.id });
    check(result.acknowledged, `${target} applies suspension`);
    await call('projects', 'recordAck', { id: `ack:${target}`, projectId: 'project:1', consumer: target, epoch: suspension.suspensionEpoch });
    await ack('projects', entry.id);
  }
  const before = await call('projects', 'completeSuspension', { id: 'cutoff:complete', projectId: 'project:1' });
  check(before.cutoffComplete, 'cutoff complete only after all acks');
  const rejected = await admit(p);
  check(rejected.status === 'rejected' && rejected.reason === 'project-suspension-cutoff', 'old permit cannot admit after cutoff');
});

await run('consumer restart must install current checkpoint before inherited effect', async () => {
  await project();
  const p = await permit('project:1', 'run:consumer');
  check((await call('integrations', 'enroll', { id: 'enroll:current', projectId: 'project:1', epoch: 1 })).ready === false, 'consumer enrollment starts not ready');
  const notReady = await call('integrations', 'acceptEffect', { id: 'effect:not-ready', effectId: 'effect:old', projectId: 'project:1', permitEpoch: p.policyEpoch });
  check(notReady.reason === 'consumer-checkpoint-not-acknowledged', 'inherited authority held before checkpoint ack');
  check((await call('integrations', 'installCheckpoint', { id: 'install:current', projectId: 'project:1', epoch: 1 })).installedEpoch === 1, 'current checkpoint installed');
  check((await call('integrations', 'ackCheckpoint', { id: 'ack:current', projectId: 'project:1', epoch: 1 })).ready, 'checkpoint acknowledged');
  check((await call('integrations', 'acceptEffect', { id: 'effect:inflight', effectId: 'effect:old', projectId: 'project:1', permitEpoch: 1 })).status === 'in-flight', 'effect accepted once ready');
  const duplicate = await call('integrations', 'acceptEffect', { id: 'effect:inflight', effectId: 'effect:old', projectId: 'project:1', permitEpoch: 1 });
  check(duplicate.replay, 'effect identity is idempotent');
});

await run('queued old effect is cut off while accepted effect remains in flight', async () => {
  await project();
  await call('integrations', 'enroll', { id: 'enroll:effect', projectId: 'project:1', epoch: 1 });
  await call('integrations', 'installCheckpoint', { id: 'install:effect', projectId: 'project:1', epoch: 1 });
  await call('integrations', 'ackCheckpoint', { id: 'ack:effect', projectId: 'project:1', epoch: 1 });
  check((await call('integrations', 'acceptEffect', { id: 'effect:accepted', effectId: 'effect:accepted', projectId: 'project:1', permitEpoch: 1 })).status === 'in-flight', 'old effect accepted before suspension');
  const suspension = await call('projects', 'suspend', { id: 'suspend:effect', projectId: 'project:1' });
  check((await call('integrations', 'applySuspension', { id: 'apply:effect', projectId: 'project:1', suspensionEpoch: suspension.suspensionEpoch })).acknowledged, 'integration cutoff applied');
  const queued = await call('integrations', 'acceptEffect', { id: 'effect:queued', effectId: 'effect:queued', projectId: 'project:1', permitEpoch: 1 });
  check(queued.reason === 'effect-before-acknowledged-cutoff', 'queued old effect rejected');
  equal((await q(`SELECT status FROM integrations.effect WHERE id = 'effect:accepted'`)).rows[0], { status: 'in-flight' }, 'accepted effect remains independently in flight');
});

await run('gaps, stale resumes, conflicts, and independent holds remain explicit', async () => {
  await project();
  await call('integrations', 'enroll', { id: 'enroll:gap:baseline', projectId: 'project:1', epoch: 1 });
  check((await call('integrations', 'enroll', { id: 'enroll:gap', projectId: 'project:1', epoch: 3 })).reason === 'epoch-gap', 'consumer event gap is rejected');
  const p = await permit('project:1', 'run:hold');
  const held = await call('execution', 'setHold', { id: 'hold:catalog', hold: 'catalog-quarantine' });
  check(held.ok, 'independent hold recorded');
  const blocked = await admit(p);
  check(blocked.status === 'rejected' && blocked.reason.includes('catalog-quarantine'), 'independent catalog hold blocks admission');
  const suspension = await call('projects', 'suspend', { id: 'suspend:hold', projectId: 'project:1' });
  await call('execution', 'applySuspension', { id: 'apply:hold', projectId: 'project:1', suspensionEpoch: suspension.suspensionEpoch });
  const resume = await call('projects', 'resume', { id: 'resume:hold', projectId: 'project:1' });
  check((await call('execution', 'applyResume', { id: 'apply:resume:hold', projectId: 'project:1', resumeEpoch: resume.resumeEpoch })).ok, 'new resume epoch applies');
  check((await call('execution', 'applyResume', { id: 'apply:resume:stale', projectId: 'project:1', resumeEpoch: suspension.suspensionEpoch })).reason === 'stale-resume-epoch', 'stale resume cannot clear newer state');
  check((await admit(p)).reason.includes('catalog-quarantine'), 'project resume does not clear independent hold');
});

const sourceHashes = {};
for (const file of ['PROTOCOL.md', 'worker.mjs', 'run-experiment.mjs', 'independent-review.mjs', 'package-lock.json']) {
  sourceHashes[file] = crypto.createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex');
}
const databaseVersion = (await q('SELECT version()')).rows[0].version;
const summary = { database: { ...env, version: databaseVersion }, sourceHashes, scenarios: results, assertions, failures: results.filter((x) => x.status !== 'passed').length, events };
await writeFile(new URL('results.json', import.meta.url), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ scenarios: results.length, assertions, failures: summary.failures }));
await admin.end();
if (summary.failures) process.exitCode = 1;
