// Independent review of recorded throwaway evidence. Does not rerun the fixture.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const report = JSON.parse(await readFile(new URL('results.json', import.meta.url), 'utf8'));
assert.equal(report.database.database, 'aa_scope_throwaway');
assert.equal(report.failures, 0);
assert.ok(report.scenarios.length >= 8);
for (const scenario of report.scenarios) assert.equal(scenario.status, 'passed', scenario.name);
const names = new Set(report.scenarios.map((x) => x.name));
for (const required of [
  'before-commit crash rolls back permit and outbox',
  'after-commit crash preserves permit and exact replay',
  'archive waits for durable verdict and preserves admitted work',
  'expiry reconciliation closes unused permission without resurrecting it',
  'workspace failure keeps admission and budget history',
  'suspension requires checkpoint installation and all consumer acknowledgments',
  'consumer restart must install current checkpoint before inherited effect',
  'queued old effect is cut off while accepted effect remains in flight',
  'gaps, stale resumes, conflicts, and independent holds remain explicit',
]) assert.ok(names.has(required), `missing required scenario: ${required}`);
console.log(JSON.stringify({ independent: true, scenarios: report.scenarios.length, assertions: report.assertions }));

