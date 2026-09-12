// DISPOSABLE PROTOTYPE: transactional state machine, not a production workflow grammar.
import pg from 'pg';
import { createHash } from 'node:crypto';

const command = JSON.parse(process.argv[2]);
const contexts = ['execution', 'human', 'knowledge', 'integrations', 'provider'];
if (!contexts.includes(command.context)) throw new Error('invalid context');
const context = command.context;
const client = new pg.Client({
  host: process.env.PGHOST, port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE, user: `aa_${context}`, password: 'throwaway',
});
const table = (name) => `${context}.${name}`;
const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const equal = (a, b) => canonical(a) === canonical(b);
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex').slice(0, 20);
class Rejection extends Error {}
const requireThat = (condition, message) => { if (!condition) throw new Rejection(message); };
const validInt = (n) => Number.isSafeInteger(n) && n >= 0;
const finiteTime = (n) => typeof n === 'number' && Number.isFinite(n);
let now;
async function refreshTime() {
  now = Number((await client.query('SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now')).rows[0].now);
}

async function get(id, lock = true) {
  const result = await client.query(`SELECT state FROM ${table('records')} WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return result.rows[0]?.state;
}
async function put(id, state) {
  await client.query(`INSERT INTO ${table('records')}(id,state) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state`, [id, JSON.stringify(state)]);
}
async function create(id, state) {
  const result = await client.query(`INSERT INTO ${table('records')}(id,state) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING RETURNING id`, [id, JSON.stringify(state)]);
  requireThat(result.rowCount === 1, 'already_exists');
}
async function outbox(recipient, payload, suffix = '0') {
  const id = `${context}:${command.id}:${suffix}`;
  await client.query(`INSERT INTO ${table('outbox')}(id,recipient,payload) VALUES($1,$2,$3::jsonb)`, [id, recipient, JSON.stringify(payload)]);
  return id;
}
function newExecution(run, admission, deliveryId) {
  requireThat(typeof run === 'string' && run.length > 0, 'invalid_run');
  requireThat(validInt(admission.limit) && validInt(admission.maxAttempts), 'invalid_budget');
  requireThat(admission.manifest !== undefined && admission.spec !== undefined, 'admission_scope_required');
  requireThat(typeof deliveryId === 'string' && deliveryId.length > 0, 'delivery_required');
  return { run, status: 'active', version: 0, limit: admission.limit, maxAttempts: admission.maxAttempts,
    manifest: admission.manifest, spec: admission.spec, deliveryId,
    recoveryClass: admission.recoveryClass ?? 'verified-checkpoint', work: 0, attempts: 0,
    members: [], membershipFrozen: false, knowledge: {}, observed: {}, sequences: {}, gaps: {},
    approvals: [], flags: { edits: false, workspace: false, effect: false, cancel: false, gap: false },
    writer: null, generation: 0, completions: [], retry: null, wait: null, waitHistory: [], effects: {} };
}
function scope(state) {
  return { run: state.run, manifest: state.manifest, spec: state.spec,
    members: state.members };
}
function clearForWork(state, allowWait = false) {
  requireThat(state.status === 'active', 'execution_not_active');
  requireThat(allowWait || !state.wait || state.wait.resolved, 'human_wait_open');
  for (const [flag, set] of Object.entries(state.flags)) requireThat(!set, `blocked_${flag}`);
}
function chargeAction(state) {
  requireThat(state.work < state.limit, 'work_exhausted');
  state.work += 1;
}
function charge(state) {
  requireThat(state.attempts < state.maxAttempts, 'attempts_exhausted');
  chargeAction(state);
  state.attempts += 1;
}
function acquire(state, c) {
  clearForWork(state);
  requireThat(!state.retry || c.op === 'fireRetry', 'retry_pending');
  requireThat(c.expectedVersion === state.version, 'version_conflict');
  requireThat(!state.writer, state.writer?.leaseDeadline <= now ? 'lease_expired_recovery_required' : 'writer_active');
  requireThat(finiteTime(c.leaseMs) && c.leaseMs > 0, 'invalid_lease');
  charge(state);
  state.generation += 1;
  state.writer = { generation: state.generation, leaseDeadline: now + c.leaseMs };
  return { generation: state.generation, leaseDeadline: state.writer.leaseDeadline };
}
async function execution(c) {
  if (c.op === 'admit') {
    requireThat(!c.predecessor, 'use_successor_operation');
    const state = newExecution(c.run, c, c.deliveryId);
    await create(c.run, state);
    return { version: state.version, state };
  }
  const state = await get(c.run);
  await refreshTime();
  requireThat(state, 'not_found');
  let result = {};
  switch (c.op) {
    case 'freezeMembership':
      requireThat(!state.membershipFrozen, 'membership_frozen');
      requireThat(Array.isArray(c.members) && c.members.length <= 100 && c.members.every(v => typeof v === 'string' && v.length > 0), 'invalid_membership');
      requireThat(new Set(c.members).size === c.members.length, 'duplicate_member');
      state.members = c.members;
      state.membershipFrozen = true;
      break;
    case 'openWait': {
      clearForWork(state);
      requireThat(!state.writer, 'writer_active');
      requireThat(finiteTime(c.deadline) && c.deadline > now, 'invalid_deadline');
      requireThat(equal(c.manifest, state.manifest), 'manifest_mismatch');
      chargeAction(state);
      if (state.wait) (state.waitHistory ??= []).push(state.wait);
      state.wait = { requestId: `${state.run}:wait:${state.version + 1}`, manifest: c.manifest, deadline: c.deadline,
        version: state.version + 1, scope: scope(state), resolved: false, status: 'open' };
      result = { expectedVersion: state.wait.version, requestId: state.wait.requestId, scope: state.wait.scope };
      break;
    }
    case 'reissueWait': {
      requireThat(c.expectedVersion === state.version, 'version_conflict');
      requireThat(state.wait && !state.wait.resolved, 'no_open_wait');
      requireThat(state.wait.version !== state.version, 'wait_still_current');
      clearForWork(state, true);
      requireThat(!state.writer, 'writer_active');
      requireThat(finiteTime(c.deadline) && c.deadline > now, 'invalid_deadline');
      requireThat(c.manifest === undefined || equal(c.manifest, state.manifest), 'manifest_mismatch');
      chargeAction(state);
      (state.waitHistory ??= []).push({ ...state.wait, resolved: true, status: 'superseded' });
      state.wait = { requestId: `${state.run}:wait:${state.version + 1}`, manifest: state.manifest, deadline: c.deadline,
        version: state.version + 1, scope: scope(state), resolved: false, status: 'open' };
      result = { expectedVersion: state.wait.version, requestId: state.wait.requestId, scope: state.wait.scope };
      break;
    }
    case 'humanResponse':
      requireThat(state.wait && !state.wait.resolved, 'no_open_wait');
      requireThat(c.requestId === state.wait.requestId, 'request_mismatch');
      requireThat(c.expectedVersion === state.version && c.expectedVersion === state.wait.version, 'version_conflict');
      requireThat(equal(c.manifest, state.wait.manifest), 'manifest_mismatch');
      requireThat(now < state.wait.deadline, 'wait_expired');
      requireThat(c.decision === 'approve' || c.decision === 'deny', 'invalid_decision');
      clearForWork(state, true);
      state.wait.resolved = true;
      state.wait.status = c.decision === 'approve' ? 'approved' : 'denied';
      if (c.decision === 'deny') state.status = 'blocked';
      if (c.decision === 'approve') state.approvals.push({ scope: state.wait.scope, responseId: c.responseId ?? c.id });
      result = { decision: c.decision };
      break;
    case 'expireWait':
      requireThat(state.wait && !state.wait.resolved, 'no_open_wait');
      requireThat(now >= state.wait.deadline, 'wait_not_due');
      state.wait.resolved = true;
      state.wait.status = 'expired';
      if (!state.flags.cancel) state.status = 'blocked';
      break;
    case 'observeEdit': {
      requireThat(typeof c.source === 'string' && validInt(c.seq) && c.seq > 0 && c.revision !== undefined, 'invalid_observation');
      const previous = state.sequences[c.source] ?? 0;
      if (c.seq <= previous) {
        const known = state.observed[c.source] ?? state.knowledge[c.source];
        requireThat(c.seq === previous && known && equal(known.revision, c.revision), 'stale_or_conflicting_source');
        return { version: state.version, unchanged: true };
      }
      if (c.seq > previous + 1) state.gaps[c.source] = true;
      state.sequences[c.source] = c.seq;
      state.observed[c.source] = { seq: c.seq, revision: c.revision };
      state.flags.edits = true;
      state.flags.gap = Object.values(state.gaps).some(Boolean);
      break;
    }
    case 'retain':
      requireThat(c.expectedVersion === state.version, 'version_conflict');
      requireThat(equal(state.observed[c.source], { seq: c.seq, revision: c.revision }), 'observation_mismatch');
      state.knowledge[c.source] = state.observed[c.source];
      delete state.observed[c.source];
      state.flags.edits = Object.keys(state.observed).length > 0;
      break;
    case 'stopWriter':
      requireThat(state.writer, 'no_writer');
      requireThat(c.generation === state.writer.generation, 'stale_generation');
      state.writer = null;
      state.flags.workspace = true;
      break;
    case 'reconstruct':
      requireThat(c.verified === true, 'verification_required');
      requireThat(state.flags.workspace && !state.writer, 'no_workspace_recovery');
      requireThat(equal(c.pinnedSpec, state.spec), 'pinned_spec_mismatch');
      requireThat(c.recoveryClass === state.recoveryClass, 'recovery_class_mismatch');
      state.flags.workspace = false;
      break;
    case 'acquire':
      result = acquire(state, c);
      break;
    case 'complete':
      requireThat(state.writer && c.generation === state.writer.generation, 'stale_generation');
      requireThat(now < state.writer.leaseDeadline, 'lease_expired');
      state.completions.push({ generation: c.generation });
      state.writer = null;
      break;
    case 'scheduleRetry':
      clearForWork(state);
      requireThat(!state.writer, 'writer_active');
      requireThat(finiteTime(c.dueAt), 'invalid_retry_time');
      state.retry = { dueAt: c.dueAt };
      break;
    case 'fireRetry':
      requireThat(state.retry, 'no_retry');
      requireThat(now >= state.retry.dueAt, 'retry_not_due');
      result = acquire(state, c);
      state.retry = null;
      break;
    case 'requestPublication': {
      clearForWork(state);
      requireThat(!state.writer, 'writer_active');
      const publicationScope = scope(state);
      requireThat(state.approvals.some(a => equal(a.scope, publicationScope)), 'approval_required');
      const effectId = `${state.run}:publication:${digest(publicationScope)}`;
      requireThat(!state.effects[effectId], 'effect_already_accepted');
      const grantExpiresAt = c.grantExpiresAt ?? now + 60_000;
      requireThat(finiteTime(grantExpiresAt) && grantExpiresAt > now, 'invalid_grant_expiry');
      const intent = { kind: 'publication', authority: 'execution', run: state.run,
        effectId, deliveryId: state.deliveryId, scope: publicationScope,
        executionVersion: state.version + 1, grantExpiresAt };
      chargeAction(state);
      state.effects[effectId] = { status: 'pending', intent };
      state.flags.effect = true;
      const outboxId = await outbox('integrations', { op: 'reserve', run: c.run, intent, transportVerified: true });
      result = { effectId, deliveryId: state.deliveryId, intent, outboxId };
      break;
    }
    case 'publicationReceipt': {
      const effect = state.effects[c.effectId];
      requireThat(effect, 'unknown_effect');
      requireThat(c.receipt?.effectId === c.effectId && c.receipt?.deliveryId === state.deliveryId, 'receipt_scope_mismatch');
      if (effect.status === 'confirmed') requireThat(equal(effect.receipt, c.receipt), 'receipt_conflict');
      effect.status = 'confirmed';
      effect.receipt = c.receipt;
      state.flags.effect = Object.values(state.effects).some(e => e.status !== 'confirmed');
      break;
    }
    case 'cancel':
      state.flags.cancel = true;
      state.status = 'cancellation_pending';
      break;
    case 'settleCancellation':
      requireThat(state.flags.cancel, 'not_cancelled');
      requireThat(!state.writer && Object.values(state.effects).every(e => e.status === 'confirmed'), 'cancellation_unaccounted');
      state.status = 'cancelled';
      break;
    case 'reconcileGap': {
      requireThat(c.authoritative === true, 'authoritative_version_required');
      requireThat(state.gaps[c.source], 'no_gap');
      const known = state.observed[c.source] ?? state.knowledge[c.source];
      requireThat(equal(known, { seq: c.seq, revision: c.revision }), 'authoritative_version_mismatch');
      delete state.gaps[c.source];
      state.flags.gap = Object.values(state.gaps).some(Boolean);
      break;
    }
    case 'successor': {
      requireThat(c.admission && c.newRun && c.newRun !== c.run, 'new_admission_required');
      requireThat(!state.writer, 'predecessor_writer_active');
      requireThat(!state.flags.workspace && !state.flags.effect && !state.flags.gap, 'predecessor_recovery_pending');
      if (c.adopt) {
        requireThat(equal(state.observed[c.adopt.source], { seq: c.adopt.seq, revision: c.adopt.revision }), 'adoption_observation_mismatch');
        requireThat(equal(c.admission.spec, c.adopt.revision), 'adoption_spec_mismatch');
        requireThat(Object.keys(state.observed).length === 1, 'other_observations_pending');
        delete state.observed[c.adopt.source];
        state.flags.edits = false;
        state.adoptedBySuccessor = c.adopt;
      }
      requireThat(!state.flags.edits, 'predecessor_recovery_pending');
      requireThat(!state.flags.cancel || state.status === 'cancelled', 'predecessor_cancellation_pending');
      requireThat(!state.successor, 'successor_already_exists');
      const successor = newExecution(c.newRun, c.admission, state.deliveryId);
      successor.predecessor = state.run;
      await create(c.newRun, successor);
      state.successor = c.newRun;
      state.status = 'superseded';
      result = { newRun: c.newRun, state: successor };
      break;
    }
    default: throw new Rejection('unknown_operation');
  }
  state.version += 1;
  await put(c.run, state);
  return { version: state.version, ...result };
}
async function human(c) {
  const requestId = c.requestId ?? c.run;
  if (c.op === 'open') {
    requireThat(c.manifest !== undefined && validInt(c.expectedVersion) && finiteTime(c.deadline), 'invalid_wait');
    requireThat(Array.isArray(c.authorizedActors), 'authorized_actors_required');
    await create(requestId, { run: c.run, requestId, manifest: c.manifest, expectedVersion: c.expectedVersion, deadline: c.deadline,
      authorizedActors: c.authorizedActors, response: null });
    return { requestId, expectedVersion: c.expectedVersion };
  }
  requireThat(c.op === 'respond', 'unknown_operation');
  const state = await get(requestId);
  await refreshTime();
  requireThat(state, 'not_found');
  requireThat(c.run === state.run, 'request_run_mismatch');
  requireThat(!state.response, 'already_responded');
  requireThat(state.authorizedActors.includes(c.actor), 'unauthorized_actor');
  requireThat(c.expectedVersion === undefined || c.expectedVersion === state.expectedVersion, 'version_conflict');
  requireThat(now < state.deadline, 'wait_expired');
  requireThat(c.decision === 'approve' || c.decision === 'deny', 'invalid_decision');
  state.response = { actor: c.actor, decision: c.decision, responseId: `human:${c.id}` };
  const outboxId = await outbox('execution', { op: 'humanResponse', run: state.run, requestId, manifest: state.manifest,
    expectedVersion: state.expectedVersion, ...state.response });
  await put(requestId, state);
  return { outboxId, response: state.response };
}
async function knowledge(c) {
  requireThat(c.op === 'save', 'unknown_operation');
  requireThat(typeof c.source === 'string' && c.revision !== undefined, 'invalid_revision');
  await client.query(`INSERT INTO ${table('records')}(id,state) VALUES($1,'{"sources":{}}'::jsonb) ON CONFLICT DO NOTHING`, [c.run]);
  const state = await get(c.run);
  const seq = (state.sources[c.source]?.seq ?? 0) + 1;
  state.sources[c.source] = { seq, revision: c.revision };
  const outboxId = await outbox('execution', { op: 'observeEdit', run: c.run, source: c.source, seq, revision: c.revision });
  await put(c.run, state);
  return { seq, revision: c.revision, outboxId };
}
async function integrations(c) {
  if (c.op === 'reserve') {
    requireThat(c.transportVerified === true, 'trusted_transport_required');
    const intent = c.intent;
    requireThat(intent?.authority === 'execution' && intent.kind === 'publication' && intent.run === c.run &&
      intent.scope?.run === c.run && typeof intent.effectId === 'string' && typeof intent.deliveryId === 'string', 'invalid_intent');
    requireThat(intent.effectId === `${c.run}:publication:${digest(intent.scope)}`, 'intent_scope_mismatch');
    await refreshTime();
    requireThat(finiteTime(intent.grantExpiresAt) && now < intent.grantExpiresAt, 'grant_expired');
    await client.query(`INSERT INTO ${table('records')}(id,state) VALUES($1,'{"effects":{}}'::jsonb) ON CONFLICT DO NOTHING`, [c.run]);
    const state = await get(c.run);
    await refreshTime();
    requireThat(now < intent.grantExpiresAt, 'grant_expired');
    if (state.effects[intent.effectId]) requireThat(equal(state.effects[intent.effectId].intent, intent), 'intent_conflict');
    else state.effects[intent.effectId] = { intent, status: 'pending' };
    await put(c.run, state);
    return { effectId: intent.effectId, status: state.effects[intent.effectId].status };
  }
  const state = await get(c.run);
  await refreshTime();
  requireThat(state, 'not_found');
  const effect = state.effects[c.effectId];
  requireThat(effect, 'unknown_effect');
  if (c.op === 'beginEffect') {
    requireThat(effect.status === 'pending', effect.status === 'unknown' ? 'effect_unknown_query_only' : 'effect_already_confirmed');
    requireThat(now < effect.intent.grantExpiresAt, 'grant_expired');
    effect.status = 'unknown';
    await put(c.run, state);
    return { effectId: c.effectId, deliveryId: effect.intent.deliveryId, status: 'unknown', callPermitted: true };
  }
  requireThat(c.op === 'recordReceipt', 'unknown_operation');
  requireThat(effect.status === 'unknown' || effect.status === 'confirmed', 'effect_not_started');
  requireThat(c.receipt?.effectId === c.effectId && c.receipt?.deliveryId === effect.intent.deliveryId, 'receipt_scope_mismatch');
  if (effect.status === 'confirmed') requireThat(equal(effect.receipt, c.receipt), 'receipt_conflict');
  effect.status = 'confirmed';
  effect.receipt = c.receipt;
  const outboxId = await outbox('execution', { op: 'publicationReceipt', run: c.run, effectId: c.effectId, receipt: c.receipt });
  await put(c.run, state);
  return { status: 'confirmed', outboxId };
}
async function provider(c) {
  requireThat(typeof c.effectId === 'string', 'effect_id_required');
  const effectKey = `effect:${c.effectId}`;
  if (c.op === 'query') {
    const state = await get(effectKey);
    return state ? { status: 'confirmed', receipt: state.receipt } : { status: 'not_found' };
  }
  requireThat(c.op === 'createOrUpdate' && typeof c.deliveryId === 'string', 'invalid_provider_command');
  const deliveryKey = `delivery:${c.deliveryId}`;
  await client.query(`INSERT INTO ${table('records')}(id,state) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING`,
    [deliveryKey, JSON.stringify({ deliveryId: c.deliveryId, externalId: `external:${c.deliveryId}`, updates: 0 })]);
  const delivery = await get(deliveryKey);
  const existing = await get(effectKey);
  if (existing) {
    requireThat(existing.receipt.deliveryId === c.deliveryId, 'effect_delivery_conflict');
    return { receipt: existing.receipt, reused: true };
  }
  delivery.updates += 1;
  const receipt = { effectId: c.effectId, deliveryId: c.deliveryId, externalId: delivery.externalId, version: delivery.updates };
  await create(effectKey, { receipt });
  await put(deliveryKey, delivery);
  return { receipt, reused: false };
}
async function main() {
  await client.connect();
  if (command.op === 'snapshot') {
    const state = await get(command.run, false);
    console.log(JSON.stringify({ ok: true, state: state ?? null }));
    return;
  }
  requireThat(typeof command.id === 'string' && command.id.length > 0, 'command_id_required');
  const payload = { ...command };
  delete payload.crash;
  await client.query('BEGIN');
  await refreshTime();
  await client.query(`INSERT INTO ${table('inbox')}(id,payload) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING`, [command.id, JSON.stringify(payload)]);
  const row = (await client.query(`SELECT outcome, payload=$2::jsonb AS matches FROM ${table('inbox')} WHERE id=$1 FOR UPDATE`, [command.id, JSON.stringify(payload)])).rows[0];
  if (!row.matches) {
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ ok: false, error: 'idempotency_payload_conflict' }));
    return;
  }
  if (row.outcome !== null) {
    await client.query('COMMIT');
    const replay = context === 'integrations' && command.op === 'beginEffect' && row.outcome.ok
      ? { ...row.outcome, callPermitted: false, replayed: true } : row.outcome;
    console.log(JSON.stringify(replay));
    return;
  }
  await client.query('SAVEPOINT domain_change');
  let outcome;
  try {
    const result = await ({ execution, human, knowledge, integrations, provider }[context])(command);
    outcome = { ok: true, ...result };
  } catch (error) {
    if (!(error instanceof Rejection)) throw error;
    await client.query('ROLLBACK TO SAVEPOINT domain_change');
    outcome = { ok: false, error: error.message };
  }
  await client.query(`UPDATE ${table('inbox')} SET outcome=$2::jsonb WHERE id=$1`, [command.id, JSON.stringify(outcome)]);
  if (command.crash === 'beforeCommit') process.kill(process.pid, 'SIGKILL');
  await client.query('COMMIT');
  if (command.crash === 'afterCommit') process.kill(process.pid, 'SIGKILL');
  console.log(JSON.stringify(outcome));
}
try { await main(); }
catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  console.log(JSON.stringify({ ok: false, error: error instanceof Rejection ? error.message : error.code ?? error.message }));
  process.exitCode = 1;
} finally { await client.end(); }
