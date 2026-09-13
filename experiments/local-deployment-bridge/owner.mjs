// THROWAWAY local live bridge owner. Caller authentication is enforced by gateway; AWS by Integrations.
import pg from 'pg';
import { createHash } from 'node:crypto';
const c = JSON.parse(process.argv[2]);
const ctx = c.context;
if (!['execution', 'integrations'].includes(ctx)) throw Error('invalid context');
const client = new pg.Client({user: `aa_${ctx}`, password: 'throwaway', application_name:`aa-authority-${ctx}-${c.id ?? c.receipt?.id}`});
const canonical = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const hash = x => createHash('sha256').update(canonical(x)).digest('hex');
const q = async (s, args=[]) => (await client.query(s, args)).rows;
const check = (yes, reason) => { if (!yes) throw Error(reason); };
let result;
await client.connect();
await client.query('BEGIN');
try {
  if (ctx === 'integrations') {
    if (c.op === 'dispatch-intent') {
      const prior = (await q('SELECT * FROM integrations.intents WHERE id=$1 FOR UPDATE', [c.id]))[0];
      if (prior) {
        check(prior.digest === hash(c.manifest), 'payload-conflict');
        result = {verdict: 'replay-no-dispatch', state: prior.state};
      } else {
        await q("INSERT INTO integrations.intents VALUES($1,$2,'may-have-dispatched')", [c.id, hash(c.manifest)]);
        result = {verdict: 'one-dispatch-admitted'};
      }
    } else if (c.op === 'persist-receipt') {
      const prior = (await q('SELECT * FROM integrations.receipts WHERE id=$1 FOR UPDATE', [c.receipt.id]))[0];
      if (prior) {
        check(canonical(prior.payload) === canonical(c.receipt), 'receipt-conflict');
        result = {verdict: 'receipt-replay'};
      } else {
        await q('INSERT INTO integrations.receipts VALUES($1,$2)', [c.receipt.id, c.receipt]);
        await q('INSERT INTO integrations.outbox VALUES($1,$2)', [c.receipt.id, c.receipt]);
        result = {verdict: 'receipt-and-outbox-committed'};
      }
    } else throw Error('unknown operation');
  } else {
    // One environment row serializes this reduced owner. Database time is read AFTER lock.
    const env = (await q('SELECT * FROM execution.environments WHERE id=$1 FOR UPDATE', [c.env]))[0];
    check(env, 'unknown-environment');
    const effect = (await q('SELECT * FROM execution.effects WHERE id=$1 FOR UPDATE', [c.id]))[0];
    check(effect && effect.env === c.env, 'effect-scope');
    const now = (await q('SELECT clock_timestamp() AS now'))[0].now;
    if (c.op === 'claim') {
      check(hash(c.manifest) === effect.digest && canonical(c.manifest) === canonical(effect.manifest), 'manifest-mismatch');
      check(effect.state === 'approved', 'already-consumed');
      check(!effect.revoked && !effect.canceled && now < effect.expires_at, 'authority-closed');
      if (effect.kind !== 'rollback') {
        check(Number.isFinite(c.authentication_expiry) && now.getTime() < c.authentication_expiry * 1000, 'authentication-expired');
        const binding = (await q('SELECT * FROM execution.dispatches WHERE run_id=$1 AND effect=$2', [c.run,c.id]))[0];
        check(binding && c.attempt === 1 && binding.digest === effect.digest && binding.workflow_sha === effect.manifest.workflow_revision, 'dispatch-binding');
      }
      if(effect.manifest.staging_effect && effect.kind!=='rollback'){
        const staging=(await q('SELECT * FROM execution.effects WHERE id=$1',[effect.manifest.staging_effect]))[0];
        check(staging?.state==='succeeded' && staging.receipt?.observed_artifact===effect.manifest.artifact,'staging-verification-required');
      }
      check(!env.hold, 'independent-hold');
      check(env.generation === effect.manifest.environment_generation, 'environment-generation-mismatch');
      check(env.current_release === effect.expected_prior, 'predecessor-mismatch');
      if (effect.kind === 'rollback') {
        const parent = (await q('SELECT * FROM execution.effects WHERE id=$1 FOR UPDATE', [effect.parent]))[0];
        check(parent?.state === 'failed' && parent.allow_rollback && env.owner === parent.id, 'rollback-not-authorized');
        check(now < parent.rollback_until, 'rollback-envelope-expired');
        const target = Object.fromEntries(Object.keys(parent.manifest.rollback_target).map(k => [k,effect.manifest[k]]));
        check(canonical(target) === canonical(parent.manifest.rollback_target), 'rollback-target-mismatch');
      } else check(env.owner === null, 'environment-obligation-open');
      await q("UPDATE execution.effects SET state='claimed', claim_run=$2, claim_attempt=$3, consumed_at=$4 WHERE id=$1", [c.id,c.run,c.attempt,now]);
      await q('UPDATE execution.environments SET owner=$2,generation=generation+1 WHERE id=$1', [c.env,c.id]);
      await q('INSERT INTO execution.outbox VALUES($1,$2)', [`claim:${c.id}`, {effect:c.id,digest:effect.digest,run:c.run,attempt:c.attempt,generation:env.generation+1,consumed_at:now}]);
      result = {verdict:'claim-admitted', generation:env.generation+1, consumed_at:now};
    } else if (['revoke','cancel'].includes(c.op)) {
      await q(`UPDATE execution.effects SET ${c.op === 'revoke' ? 'revoked' : 'canceled'}=true WHERE id=$1`, [c.id]);
      result = {verdict:'future-admission-closed', already_in_flight:effect.state === 'claimed'};
    } else if (c.op === 'receipt') {
      const r = c.receipt;
      const old = (await q('SELECT * FROM execution.inbox WHERE id=$1', [r.id]))[0];
      if (old) {
        check(old.digest === hash(r), 'inbox-payload-conflict');
        result = {verdict:'receipt-redelivery', original_verdict:old.verdict};
      } else {
        const exact = r.effect === effect.id && r.env === effect.env && r.digest === effect.digest
          && r.run === effect.claim_run && r.attempt === effect.claim_attempt
          && r.generation === effect.manifest.environment_generation + 1 && r.generation === env.generation;
        const verdict = exact && r.observed_artifact === effect.manifest.artifact && env.owner === effect.id && effect.state === 'claimed'
          && ['healthy','failed-health'].includes(r.outcome) ? 'accepted' : 'rejected-stale-or-conflicting';
        await q('INSERT INTO execution.inbox VALUES($1,$2,$3,$4)', [r.id,hash(r),r,verdict]);
        if (verdict === 'accepted') {
          await q('UPDATE execution.effects SET state=$2, receipt=$3 WHERE id=$1', [effect.id, r.outcome === 'healthy' ? 'succeeded' : 'failed', r]);
          // Failed health retains an obligation until a separately authorized restoration.
          await q('UPDATE execution.environments SET current_release=$2,owner=$3 WHERE id=$1', [c.env,r.observed_artifact,r.outcome === 'healthy' ? null : effect.id]);
        }
        result = {verdict};
      }
    } else throw Error('unknown operation');
  }
  await q(`INSERT INTO ${ctx}.journal(command,result) VALUES($1,$2)`,[c,result]);
  await client.query('COMMIT');
  if (c.crash_after_commit) {
    process.stdout.write(JSON.stringify({barrier:'committed-before-ack'}));
    process.kill(process.pid, 'SIGKILL');
  }
} catch (error) {
  await client.query('ROLLBACK');
  result = {verdict:'rejected',reason:error.message};
  // Keep conflict/rejection history in this owner; preserve the original immutable record.
  await q(`INSERT INTO ${ctx}.journal(command,result) VALUES($1,$2)`,[c,result]);
}
await client.end();
console.log(JSON.stringify(result));
