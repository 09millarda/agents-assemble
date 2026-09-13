// THROWAWAY architecture experiment. Never import this into application code.
import { Client } from 'pg';
import crypto from 'node:crypto';

const command = JSON.parse(process.argv[2] ?? '{}');
const users = { projects: 'aa_projects', execution: 'aa_execution', integrations: 'aa_integrations' };
const context = command.context;
const user = users[context];
if (!user) throw new Error(`unknown context: ${context}`);

const body = { ...command };
delete body.crash;
const payloadHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
const crash = (stage) => {
  if (command.crash === stage) process.kill(process.pid, 'SIGKILL');
};

async function connect() {
  const db = new Client({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'aa_scope_throwaway',
    user,
  });
  await db.connect();
  return db;
}

async function handled(run) {
  const db = await connect();
  try {
    await db.query('BEGIN');
    const existing = await db.query(`SELECT payload_hash, outcome FROM ${context}.inbox WHERE id = $1 FOR UPDATE`, [command.id]);
    if (existing.rowCount) {
      if (existing.rows[0].payload_hash !== payloadHash) {
        await db.query('ROLLBACK');
        console.log(JSON.stringify({ ok: false, conflict: true, error: 'message payload conflict' }));
        return;
      }
      await db.query('COMMIT');
      console.log(JSON.stringify({ ...existing.rows[0].outcome, replay: true }));
      return;
    }
    await db.query(`INSERT INTO ${context}.inbox(id, payload_hash, payload) VALUES ($1, $2, $3)`, [command.id, payloadHash, body]);
    const outcome = await run(db);
    await db.query(`UPDATE ${context}.inbox SET outcome = $2 WHERE id = $1`, [command.id, outcome]);
    crash('beforeCommit');
    await db.query('COMMIT');
    crash('afterCommit');
    console.log(JSON.stringify(outcome));
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch {}
    console.log(JSON.stringify({ ok: false, error: error.message, code: error.code }));
  } finally {
    await db.end().catch(() => {});
  }
}

const outbox = async (db, id, recipient, message) => {
  await db.query(`INSERT INTO ${context}.outbox(id, recipient, payload) VALUES ($1, $2, $3)`, [id, recipient, message]);
};

async function projects() {
  return handled(async (tx) => {
    if (command.op === 'createProject') {
      await tx.query(`INSERT INTO projects.project(id, lifecycle, policy_epoch, suspension_epoch) VALUES ($1, 'open', 1, 0)`, [command.projectId]);
      return { ok: true, projectId: command.projectId, policyEpoch: 1 };
    }
    if (command.op === 'registerConsumer') {
      await tx.query(`INSERT INTO projects.consumer(project_id, consumer, ack_epoch) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`, [command.projectId, command.consumer]);
      return { ok: true, consumer: command.consumer };
    }
    if (command.op === 'issuePermit') {
      const project = (await tx.query(`SELECT * FROM projects.project WHERE id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (!project || project.lifecycle !== 'open') return { ok: false, reason: 'project-not-open' };
      const id = `permit:${command.runId}`;
      await tx.query(`INSERT INTO projects.permit(id, request_id, run_id, project_id, policy_epoch, scope_digest, expires_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'issued')`, [id, command.requestId, command.runId, command.projectId, project.policy_epoch, command.scopeDigest, command.expiresAt]);
      await outbox(tx, `scope:${command.runId}:${command.requestId}`, 'execution', { op: 'receivePermit', permitId: id, runId: command.runId, projectId: command.projectId, policyEpoch: project.policy_epoch, scopeDigest: command.scopeDigest, expiresAt: command.expiresAt });
      return { ok: true, permitId: id, runId: command.runId, policyEpoch: project.policy_epoch };
    }
    if (command.op === 'recordVerdict') {
      const permit = (await tx.query(`SELECT * FROM projects.permit WHERE id = $1 FOR UPDATE`, [command.permitId])).rows[0];
      if (!permit) return { ok: false, reason: 'unknown-permit' };
      if (permit.status !== 'issued') {
        const prior = permit.verdict ?? {};
        if (JSON.stringify(prior) === JSON.stringify(command.verdict)) return { ok: true, duplicate: true, status: permit.status };
        return { ok: false, reason: 'verdict-conflict' };
      }
      const status = command.verdict.status;
      if (!['accepted', 'rejected', 'expired-unused'].includes(status)) return { ok: false, reason: 'invalid-verdict' };
      await tx.query(`UPDATE projects.permit SET status = $2, verdict = $3 WHERE id = $1`, [command.permitId, status, command.verdict]);
      return { ok: true, status };
    }
    if (command.op === 'archive') {
      const project = (await tx.query(`SELECT * FROM projects.project WHERE id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (!project) return { ok: false, reason: 'unknown-project' };
      if (project.lifecycle === 'archived') return { ok: true, state: 'archived', duplicate: true };
      await tx.query(`UPDATE projects.project SET lifecycle = 'closing', archive_requested_at = clock_timestamp() WHERE id = $1`, [command.projectId]);
      return { ok: true, state: 'closing' };
    }
    if (command.op === 'reconcileExpiry') {
      const permit = (await tx.query(`SELECT * FROM projects.permit WHERE id = $1 FOR UPDATE`, [command.permitId])).rows[0];
      if (!permit) return { ok: false, reason: 'unknown-permit' };
      if (permit.status === 'issued' && new Date(permit.expires_at).getTime() <= Date.now()) {
        await tx.query(`UPDATE projects.permit SET status = 'expired-unused', verdict = $2 WHERE id = $1`, [command.permitId, { status: 'expired-unused', reason: 'expiry-reconciled' }]);
        return { ok: true, status: 'expired-unused' };
      }
      return { ok: false, reason: 'not-expired-or-already-resolved' };
    }
    if (command.op === 'completeArchive') {
      const project = (await tx.query(`SELECT * FROM projects.project WHERE id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      const pending = await tx.query(`SELECT 1 FROM projects.permit WHERE project_id = $1 AND status = 'issued' LIMIT 1`, [command.projectId]);
      if (!project || project.lifecycle !== 'closing') return { ok: false, reason: 'not-closing' };
      if (pending.rowCount) return { ok: false, pending: true, reason: 'permit-verdicts-pending' };
      await tx.query(`UPDATE projects.project SET lifecycle = 'archived' WHERE id = $1`, [command.projectId]);
      return { ok: true, state: 'archived' };
    }
    if (command.op === 'suspend') {
      const project = (await tx.query(`SELECT * FROM projects.project WHERE id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (!project || project.lifecycle === 'archived') return { ok: false, reason: 'project-not-suspendable' };
      if (project.lifecycle === 'suspended') return { ok: true, suspensionEpoch: project.suspension_epoch, duplicate: true };
      const epoch = project.policy_epoch + 1;
      await tx.query(`UPDATE projects.project SET lifecycle = 'suspended', policy_epoch = $2, suspension_epoch = $2 WHERE id = $1`, [command.projectId, epoch]);
      const consumers = (await tx.query(`SELECT consumer FROM projects.consumer WHERE project_id = $1 ORDER BY consumer`, [command.projectId])).rows;
      for (const { consumer } of consumers) {
        await outbox(tx, `suspend:${command.projectId}:${epoch}:${consumer}`, consumer, { op: 'applySuspension', projectId: command.projectId, suspensionEpoch: epoch });
      }
      return { ok: true, suspensionEpoch: epoch, consumers: consumers.map((x) => x.consumer) };
    }
    if (command.op === 'recordAck') {
      const row = (await tx.query(`SELECT * FROM projects.consumer WHERE project_id = $1 AND consumer = $2 FOR UPDATE`, [command.projectId, command.consumer])).rows[0];
      if (!row) return { ok: false, reason: 'unknown-consumer' };
      if (command.epoch < row.ack_epoch) return { ok: false, reason: 'stale-ack' };
      await tx.query(`UPDATE projects.consumer SET ack_epoch = $3 WHERE project_id = $1 AND consumer = $2`, [command.projectId, command.consumer, command.epoch]);
      return { ok: true, consumer: command.consumer, epoch: command.epoch };
    }
    if (command.op === 'completeSuspension') {
      const project = (await tx.query(`SELECT * FROM projects.project WHERE id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      const pending = await tx.query(`SELECT consumer FROM projects.consumer WHERE project_id = $1 AND ack_epoch < $2`, [command.projectId, project?.suspension_epoch ?? 0]);
      if (!project || project.lifecycle !== 'suspended') return { ok: false, reason: 'not-suspended' };
      if (pending.rowCount) return { ok: false, pending: pending.rows.map((x) => x.consumer) };
      await tx.query(`UPDATE projects.project SET cutoff_complete = true WHERE id = $1`, [command.projectId]);
      return { ok: true, cutoffComplete: true, epoch: project.suspension_epoch };
    }
    if (command.op === 'resume') {
      const project = (await tx.query(`SELECT * FROM projects.project WHERE id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (!project || project.lifecycle !== 'suspended') return { ok: false, reason: 'not-suspended' };
      const epoch = project.policy_epoch + 1;
      await tx.query(`UPDATE projects.project SET lifecycle = 'open', policy_epoch = $2, cutoff_complete = false WHERE id = $1`, [command.projectId, epoch]);
      await outbox(tx, `resume:${command.projectId}:${epoch}`, 'execution', { op: 'applyResume', projectId: command.projectId, resumeEpoch: epoch });
      return { ok: true, resumeEpoch: epoch };
    }
    return { ok: false, reason: `unsupported-project-operation:${command.op}` };
  });
}

async function execution() {
  return handled(async (tx) => {
    if (command.op === 'receivePermit') {
      await tx.query(`INSERT INTO execution.candidate(id, run_id, project_id, permit_id, policy_epoch, scope_digest, expires_at, state) VALUES ($1, $2, $3, $4, $5, $6, $7, 'candidate') ON CONFLICT (id) DO NOTHING`, [`run:${command.runId}`, command.runId, command.projectId, command.permitId, command.policyEpoch, command.scopeDigest, command.expiresAt]);
      await tx.query(`INSERT INTO execution.project_gate(project_id, project_epoch, project_hold) VALUES ($1, $2, false) ON CONFLICT (project_id) DO NOTHING`, [command.projectId, command.policyEpoch]);
      return { ok: true, runId: command.runId, permitId: command.permitId };
    }
    if (command.op === 'admit') {
      const candidate = (await tx.query(`SELECT * FROM execution.candidate WHERE id = $1 FOR UPDATE`, [`run:${command.runId}`])).rows[0];
      if (!candidate) return { ok: false, reason: 'candidate-not-reserved' };
      const immutable = { permitId: candidate.permit_id, scopeDigest: candidate.scope_digest };
      if (candidate.state !== 'candidate') {
        if (JSON.stringify(immutable) === JSON.stringify({ permitId: command.permitId, scopeDigest: command.scopeDigest })) return { ok: true, status: candidate.state, replay: true, budgetCharged: candidate.budget_charged };
        return { ok: false, reason: 'candidate-input-conflict' };
      }
      const gate = (await tx.query(`SELECT * FROM execution.project_gate WHERE project_id = $1`, [candidate.project_id])).rows[0];
      const holds = await tx.query(`SELECT hold FROM execution.hold WHERE active = true`);
      let status = 'accepted';
      let reason = null;
      if (!gate || gate.project_epoch < candidate.policy_epoch) { status = 'rejected'; reason = 'scope-checkpoint-not-current'; }
      else if (gate.project_hold) { status = 'rejected'; reason = 'project-suspension-cutoff'; }
      else if (holds.rowCount) { status = 'rejected'; reason = `independent-hold:${holds.rows.map((x) => x.hold).join(',')}`; }
      else if (new Date(candidate.expires_at).getTime() <= Date.now()) { status = 'expired-unused'; reason = 'scope-permit-expired'; }
      const verdict = { status, reason };
      await tx.query(`UPDATE execution.candidate SET state = $2, verdict = $3, budget_charged = $4 WHERE id = $1`, [`run:${command.runId}`, status, verdict, status === 'accepted' ? 1 : 0]);
      if (status === 'accepted') await outbox(tx, `workspace:${command.runId}`, 'execution', { op: 'prepareWorkspace', runId: command.runId });
      return { ok: true, ...verdict, budgetCharged: status === 'accepted' ? 1 : 0 };
    }
    if (command.op === 'prepareWorkspace') {
      const candidate = (await tx.query(`SELECT * FROM execution.candidate WHERE id = $1 FOR UPDATE`, [`run:${command.runId}`])).rows[0];
      if (!candidate || candidate.state !== 'accepted') return { ok: false, reason: 'run-not-admitted' };
      if (candidate.workspace_state) return { ok: true, workspace: candidate.workspace_state, replay: true, admissionState: candidate.state, budgetCharged: candidate.budget_charged };
      await tx.query(`UPDATE execution.candidate SET workspace_state = $2 WHERE id = $1`, [`run:${command.runId}`, command.result ?? 'failed']);
      return { ok: true, workspace: command.result ?? 'failed', admissionState: candidate.state, budgetCharged: candidate.budget_charged };
    }
    if (command.op === 'applySuspension') {
      const gate = (await tx.query(`SELECT * FROM execution.project_gate WHERE project_id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (gate && command.suspensionEpoch <= gate.project_epoch) return { ok: true, duplicate: true, epoch: gate.project_epoch };
      if (gate && command.suspensionEpoch !== gate.project_epoch + 1) return { ok: false, reason: 'epoch-gap' };
      if (!gate) await tx.query(`INSERT INTO execution.project_gate(project_id, project_epoch, project_hold) VALUES ($1, $2, true)`, [command.projectId, command.suspensionEpoch]);
      else await tx.query(`UPDATE execution.project_gate SET project_epoch = $2, project_hold = true WHERE project_id = $1`, [command.projectId, command.suspensionEpoch]);
      return { ok: true, epoch: command.suspensionEpoch, acknowledged: true };
    }
    if (command.op === 'applyResume') {
      const gate = (await tx.query(`SELECT * FROM execution.project_gate WHERE project_id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (!gate) return { ok: false, reason: 'resume-without-suspension' };
      if (command.resumeEpoch <= gate.project_epoch) return { ok: false, reason: 'stale-resume-epoch' };
      await tx.query(`UPDATE execution.project_gate SET project_epoch = $2, project_hold = false WHERE project_id = $1`, [command.projectId, command.resumeEpoch]);
      return { ok: true, epoch: command.resumeEpoch, projectHold: false };
    }
    if (command.op === 'setHold') {
      await tx.query(`INSERT INTO execution.hold(hold, active) VALUES ($1, true) ON CONFLICT (hold) DO UPDATE SET active = true`, [command.hold]);
      return { ok: true, hold: command.hold, active: true };
    }
    if (command.op === 'clearHold') {
      await tx.query(`UPDATE execution.hold SET active = false WHERE hold = $1`, [command.hold]);
      return { ok: true, hold: command.hold, active: false };
    }
    return { ok: false, reason: `unsupported-execution-operation:${command.op}` };
  });
}

async function integrations() {
  return handled(async (tx) => {
    if (command.op === 'enroll') {
      const current = (await tx.query(`SELECT * FROM integrations.consumer WHERE project_id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (current && command.epoch > current.known_epoch + 1) return { ok: false, reason: 'epoch-gap' };
      if (!current) await tx.query(`INSERT INTO integrations.consumer(project_id, known_epoch, installed_epoch, ack_epoch, cutoff_epoch) VALUES ($1, $2, 0, 0, 0)`, [command.projectId, command.epoch]);
      else await tx.query(`UPDATE integrations.consumer SET known_epoch = $2, installed_epoch = 0, ack_epoch = 0 WHERE project_id = $1`, [command.projectId, command.epoch]);
      return { ok: true, enrolledEpoch: command.epoch, ready: false };
    }
    if (command.op === 'installCheckpoint') {
      const current = (await tx.query(`SELECT * FROM integrations.consumer WHERE project_id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (!current || command.epoch !== current.known_epoch) return { ok: false, reason: 'checkpoint-epoch-not-current' };
      await tx.query(`UPDATE integrations.consumer SET installed_epoch = $2 WHERE project_id = $1`, [command.projectId, command.epoch]);
      return { ok: true, installedEpoch: command.epoch };
    }
    if (command.op === 'ackCheckpoint') {
      const current = (await tx.query(`SELECT * FROM integrations.consumer WHERE project_id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (!current || current.installed_epoch !== command.epoch) return { ok: false, reason: 'checkpoint-not-installed' };
      await tx.query(`UPDATE integrations.consumer SET ack_epoch = $2 WHERE project_id = $1`, [command.projectId, command.epoch]);
      return { ok: true, acknowledgedEpoch: command.epoch, ready: true };
    }
    if (command.op === 'applySuspension') {
      const current = (await tx.query(`SELECT * FROM integrations.consumer WHERE project_id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (!current) return { ok: false, reason: 'consumer-not-enrolled' };
      if (command.suspensionEpoch < current.known_epoch) return { ok: false, reason: 'stale-suspension' };
      await tx.query(`UPDATE integrations.consumer SET cutoff_epoch = $2 WHERE project_id = $1`, [command.projectId, command.suspensionEpoch]);
      return { ok: true, epoch: command.suspensionEpoch, acknowledged: true };
    }
    if (command.op === 'applyResume') {
      const current = (await tx.query(`SELECT * FROM integrations.consumer WHERE project_id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      if (!current || command.resumeEpoch <= current.known_epoch) return { ok: false, reason: 'stale-resume-epoch' };
      await tx.query(`UPDATE integrations.consumer SET known_epoch = $2, installed_epoch = 0, ack_epoch = 0, cutoff_epoch = 0 WHERE project_id = $1`, [command.projectId, command.resumeEpoch]);
      return { ok: true, epoch: command.resumeEpoch, ready: false };
    }
    if (command.op === 'acceptEffect') {
      const current = (await tx.query(`SELECT * FROM integrations.consumer WHERE project_id = $1 FOR UPDATE`, [command.projectId])).rows[0];
      const existing = (await tx.query(`SELECT * FROM integrations.effect WHERE id = $1 FOR UPDATE`, [command.effectId])).rows[0];
      if (existing) return { ok: true, status: existing.status, replay: true };
      if (!current || current.ack_epoch < command.permitEpoch) return { ok: false, reason: 'consumer-checkpoint-not-acknowledged' };
      if (current.cutoff_epoch >= command.permitEpoch) return { ok: false, reason: 'effect-before-acknowledged-cutoff' };
      await tx.query(`INSERT INTO integrations.effect(id, project_id, permit_epoch, status) VALUES ($1, $2, $3, 'in-flight')`, [command.effectId, command.projectId, command.permitEpoch]);
      return { ok: true, status: 'in-flight', effectId: command.effectId };
    }
    return { ok: false, reason: `unsupported-integration-operation:${command.op}` };
  });
}

if (context === 'projects') await projects();
else if (context === 'execution') await execution();
else await integrations();
