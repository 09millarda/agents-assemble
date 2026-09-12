# Durable execution persistence experiment

Date: 2026-09-12 · Decision [#7](https://github.com/09millarda/agents-assemble/issues/7) · Map [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Verdict and reproduction

**Select an Execution-owned PostgreSQL state machine with context-local inbox/outbox workers. All 28 final scenarios passed with 353 assertions.** [ADR 0003](../architecture/0003-durable-execution-and-recovery.md) records the protocol and the [cited comparison](durable-substrate-comparison.md) records alternatives.

The [disposable experiment and full recorded evidence](https://github.com/09millarda/agents-assemble/tree/35aad60/experiments/durable-execution) are archived at `35aad60` on `codex/prototype-durable-execution`, separately from main. It uses Node 24, PostgreSQL 17.9 in a dedicated Docker container, and `pg` 8.16.3 pinned in its local lockfile. Run `bash run.sh` in the experiment directory to create an isolated database, install the prototype dependency, run the probes and remove the container including its throwaway data. No existing application database or live provider is used. Runtime/package choices here are experiment inputs, not production dependency or licensing selections.

Each command executes in a new Node worker process. Each context connects as its own schema-owner role. The harness provisions schema/roles and reads full state as a test administrator; workers cannot read/write other contexts. A transport fixture delivers producer outbox payloads to recipient processes, then acknowledges with a separate producer-role connection. `beforeCommit`/`afterCommit` fault points send real SIGKILL to the worker. A separate probe kills the PostgreSQL container process and restarts the same database files.

The provider is a distinct process/schema with its own durable delivery map and receipts. It models an idempotent provider with authoritative lookup; it is not GitHub, Git or a harness. Integration receipt loss and Execution receipt-delivery loss are exercised separately. Source observations model one contiguous synthetic per-artifact revision stream.

## Evidence matrix

The [machine-readable results](https://github.com/09millarda/agents-assemble/blob/35aad60/experiments/durable-execution/results.json) report **28 passed, zero failed, 353 assertions**. The [independent review](https://github.com/09millarda/agents-assemble/blob/35aad60/experiments/durable-execution/independent-recovery-review.md) additionally passed **22 assertions** on the repaired wait/retry path in a separate container; these are not included in the suite count. The archive includes full record/inbox/outbox snapshots, source, protocol and a standalone HTML trace viewer. Browser inspection verified scenario selection, step navigation and the external-success-before-receipt snapshot.

An early retry timing probe used a 600 ms future deadline; the intervening worker/snapshot operations outlasted it. The final probe uses a 3 s window and waits against its absolute deadline. This corrected the test precondition; the runtime correctly accepted a retry once it was due.

| Boundary | Required observed result |
| --- | --- |
| Producer pre/post commit death | Precommit leaves no state/inbox/outbox; postcommit keeps accepted state and retry returns the same verdict. |
| Consumer precommit / postcommit before acknowledgment | No partial inbox/state commit; redelivery after accepted commit makes no second transition or invocation. Changed payload under the same ID conflicts. |
| Role ownership | Every context role is denied cross-context reads and outbox inserts. |
| Concurrent commands | Competing expected versions admit one assignment; duplicate command IDs consume one invocation. |
| Human delivery | Participant acceptance remains pending until Execution's own receipt; stale/expired replies do not grant approval. |
| Membership/wait/retry restart | Persisted identities, order, absolute deadlines and consumption survive new workers and database restart. A human wait holds no runner lease. |
| Edit and retain | Old replies conflict; retained scope remains original; replacement request has fresh identity and requires a fresh answer. |
| Fencing/reconstruction | Expired/stale results and stale stopped-writer acknowledgments cannot change a replacement; verified preparation does not double-charge its invocation. |
| Effect uncertainty | Provider success survives receipt loss; recovery queries the original effect and records one external resource. An uncertain begin never grants a fresh call on replay. |
| Cancel/gaps | Pre-cancel accepted intent remains an obligation; publication receipt does not clear independent cancellation, edits or source gaps. |
| Successor | Fresh explicit admission, exact adoption, no copied approvals/work/completions, same delivery mapping and a new effect identity. |

## Corrections exposed during development

- Retaining an observed revision initially changed the approval scope through observation history. Separate acknowledgment history from frozen approval inputs.
- Reconstruction initially charged once during preparation and again at assignment. Charge the new invocation once at admission; require its pinned spec and declared recovery class.
- A stopped-writer acknowledgment initially lacked a generation, and a human wait could retain a writer. Scope the acknowledgment and reject waits until the writer is accounted for.
- The saved result of a begun effect initially repeated a first-dispatch hint. Exact replay now exposes acceptance with no new call permission. This fixture-level response behavior is not a network-wide exactly-once guarantee.
- An observed edit followed by retain left the unresolved wait bound to an obsolete version. Explicit replacement requests preserve the old audit record and need a new answer.
- A direct acquisition could bypass a persisted retry deadline. Require the due retry transition while backoff is pending.
- Human and publication admissions initially escaped the shared work counter. Charge these modeled invocations in the same local acceptance transaction.

## Limits

This is a reduced persistence model, not #6's full interpreter migrated to SQL. It proves the exercised local transition boundaries and finite fixtures. Full starter journeys, branch joins, per-occurrence retry accounting, package-cap validation and production schemas still require integration conformance. The reduced model uses one runner occurrence with a run-level attempt cap and common work consumption for runner, human and publication admissions.

Authorization, exact intent transport, receipt authenticity, authoritative source snapshots and verified original-input checkpoints are trusted inputs. A stored marker such as `transportVerified` or `verified` is not proof of a secure production adapter. A provider lookup that cannot prove success/non-execution leaves recovery blocked. The prototype does not implement safe grant release/reissue for every no-effect or expiry case.

No inference follows about live harness account compatibility, on-disk worktrees, direct-credential fencing, model inference, cloud services, real provider idempotency, eventual receipt visibility, tenant isolation, crash safety under storage corruption, network partition, database failover, large histories, scheduling fairness, throughput or operational cost. SQL role tests establish only the schema privileges configured in this fixture. Exact live-session migration remains conditional under ADR 0001.
