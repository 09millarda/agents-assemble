# Independent adversarial review of wayfinder #6

Date: 2026-09-12. Scope: the claimed #6 prototype decision only. This review compares ADR 0002, ADR 0001, CONTEXT.md and the shared/feature/bug examples against #6. It does not select a production runtime or certify a harness. Runtime evidence is added below after the disposable implementation becomes available.

## Preliminary assessment

The baseline is internally coherent if the prototype makes three distinctions observable: Knowledge persistence versus Execution observation, accepted approval versus a human response awaiting acceptance, and a failing reproduction baseline versus the current working checkpoint. The language needs no new node kind to express either starter journey. Its difficult claims live at the Execution/adaptor boundary, so successfully interpreting the happy-path JSON alone cannot establish conformance.

The examples already correctly use the bug's `baselineCheckpoint` for reproduction and `checkpoint` for preparation/remediation. They also already prohibit automatically inheriting successor completions or approvals. These are existing requirements to test, not novel proposed amendments.

## Sharp adversarial traces

| Trace | Required result | Why a weaker test can pass incorrectly |
| --- | --- | --- |
| Knowledge saves spec r2; before its event is observed, Execution accepts a reply approving pinned r1; only then it observes r2. | Acceptance can be valid for r1 before observation. Observation stops subsequent dependent dispatch and requires explicit retain/adopt. UI distinguishes saved from observed. | One shared synchronous save/pause mutation wrongly promises a global barrier. |
| Execution observes r2 before accepting the old r1 reply. | Approval must not release dependent work while replan is unresolved. Preserve the response as stale/conflicted/pending evidence as the chosen protocol specifies. | Checking only request ID or `approved: true` allows stale responses through. |
| Human Interaction accepts one response, crashes before delivering it, then redelivers twice; a competing response races. | Exactly one Execution acceptance for the request/manifest version. Same command/payload is idempotent; competing payload conflicts visibly. | A mock where the UI directly mutates Execution omits the acceptance boundary. |
| Reuse a human command ID with different response content. | Payload conflict, never a cached success that appears to authorize the new content. | Deduplication by ID alone hides malformed/reused commands. |
| Save r2 then r3; deliver duplicate/out-of-order notifications; retain r2 against an old Execution version. | Source ordering/gaps must be tracked or reconciled. An acknowledgement of r2 cannot acknowledge r3. A stale retain command conflicts. | Assigning `observedSpec = event.spec` lets late r2 roll back r3. |
| Approve publish for spec r1/commit c1/delivery d1; substitute r2, c2, d2, operation or policy before dispatch. | Each changed binding is rejected before external write. Validated checks/review must also bind the same spec and commit. | Verifying an `approved` boolean or commit alone is insufficient. |
| Call publication using a hand-crafted approval-shaped object with exact-looking fields. | Require the canonical accepted decision receipt and current authorization, not structural shape alone. | Input JSON Schema validation cannot confer authority. |
| Pause old bug run after implementation produced fixed checkpoint cFixed, adopt edited spec into successor. | Successor starts at entry, reproduces against original failing cBase, prepares from cFixed, revalidates evidence, requests fresh approvals and preserves delivery mapping. | Using one checkpoint slot either loses the fix or demands fixed code still reproduce the bug. |
| Try adoption while the old run has an unresolved publication or active writer with no acknowledged safe pause. | Reject/block adoption at that boundary. Do not mark old run cleanly superseded. | Merely setting `old.status = superseded` cannot stop an external writer. |
| Restart after accepting forEach membership, then change the source task array or its order. | Reuse the persisted membership/order/keys; do not reread the array and expand again. | A deterministic identical test array hides resnapshotting. |
| Duplicate keys, oversized array, then keys containing delimiters or unusual values. | Reject invalid fan-out before child dispatch; accepted key values must generate collision-free identities. Define admissible key types. | String concatenation can merge structurally different node/item paths. |
| Nested repeat × forEach with local bounds each satisfied but total run allowance insufficient. | Suspend at total allowance before extra admission; restart preserves spent allowance. | Independent local counter tests do not prove a global bound. |
| Retry a safely retryable invocation, duplicate an already admitted dispatch command, then restart. | Retry: same occurrence/input/effect slot, new attempt, charged allowance. Duplicate delivery: same attempt, no extra charge or invocation. | Counting only occurrences hides retry amplification; counting messages overcharges redelivery. |
| Re-run a remediation loop after failed checks/review. | New occurrence/attempt/effect identities for the new logical iteration; previous accepted output is unchanged. | Using node ID alone collapses domain rework into retry. |
| Provider creates PR, acknowledgement is lost, Execution restarts, then effect is reconciled. | Independent provider state still contains one PR. Resolve the original effect identity/receipt instead of creating another PR. | Rewinding provider state with Execution or returning a hard-coded PR cannot show recovery. |
| Same effect identity submitted with altered payload. | Visible conflict before replay/upsert, even if business mapping is unchanged. | Provider idempotency alone may silently ignore a new payload. |
| Successor publishes under new effect identity but inherited delivery mapping. | Update/reconcile the existing logical PR; do not create another one. Distinguish delivery/business identity from run-scoped effect identity. | Testing only retry within one run misses successor duplication. |
| Cancel races with provider write success; or one parallel branch fails while sibling effect outcome is unknown. | No new dependent publication; status remains cancellation/recovery with the unknown effect visible until reconciliation. Join must not claim success or clean cancellation. | Setting all siblings `cancelled` on request erases uncertainty. |
| Unknown effect lookup confirms absence versus lookup remains inconclusive. | Absence may permit an explicitly safe replay protocol; inconclusive result must remain blocked. | Treating `not returned`/timeout as `not created` duplicates effects. |
| Last allowed reproduction or remediation iteration still fails. | `limit_reached` with evidence and human attention; never a successful end. Restart cannot refresh local/total allowance. | A test that checks only iteration count can miss accidental fallthrough to publication. |

## Minimum clarifications to record if the experiment exposes gaps

1. **Budget accounting:** define work units (a useful prototype choice is admission of each call attempt), charge retries, and ensure duplicate dispatch delivery does not charge twice. Keep local iteration bounds, total work allowance and concurrent active-attempt allowance distinct. A linked successor requires an explicit newly admitted allowance; it is not an automatic budget-reset mechanism.
2. **Receipt authority and event order:** state the accepted approval receipt identity and payload binding, Execution's acceptance check, and how source artifact versions/gaps are reconciled. Do not claim atomic ordering between independent contexts. The receipt must cover the approved operation, spec, commit where relevant, delivery target, definition and policy.
3. **Occurrence coordinates:** encode the full ordered vector of enclosing iterations and map item keys, including structural node path and run, with collision-free typed serialization. Retrying preserves it; a new iteration or run changes it.
4. **Prototype boundary:** distinguish a deterministic snapshot/crash simulator from a transaction/inbox/outbox implementation. Identify which mocked resource validators establish fixture-level checkpoint/artifact/approval validity and which live guarantees remain unproved.

These are refinements of existing guarantees, not a reason to expand the grammar or choose a framework. The durable-substrate frontier should compare whether candidate ports preserve atomic context-owned transitions/outboxes, inbox deduplication, timer/budget persistence, attempt fences and effect reconciliation under the same adversarial traces.

## Runtime evidence

The first available `runtime.js` was inspected and targeted counterexamples were executed using Node and its exported `globalThis.Conformance` API. The initial findings below are provisional until the parent reruns them after amendments. No production/framework or real harness claim follows from these executions.

| Probe | Observed initial result | Assessment |
| --- | --- | --- |
| `save(2); save(3); observe(3); observe(2); retain(2,currentVersion)` | Knowledge head remains 3, observed revision regresses to 2, retain returns `retained`, run becomes `running`. | Failure: stale notification can make a retained acknowledgement miss an already-observed newer edit. Track source-version ordering/deduplication. |
| `observe(2); retain(2,currentVersion); observe(2)` | Returns `observed`, run becomes `replan_required` again. | Failure: retaining clears the only duplicate marker; persistent observation history is necessary. |
| Dispatch `implement`; observe edit; `quiesce`; retain old spec; step ten times. | Run remains `running`, writer occurrence remains `cancelled`, no continuation. | Failure: quiescing a resumable writer needs an explicit resume/reconstruction path if retain is supported; cancellation is not pause. |
| Run `check` and `review` against spec 2 and checkpoint c; supply their accepted outputs to `approvePublish` against spec 1 and checkpoint c. | Human publication request is created for spec 1. | Failure: checkpoint equality alone does not bind evidence to the exact spec. Carry and check spec identity/provenance. |
| Create successor using predecessor's same run ID. | Accepted; lineage predecessor equals successor ID. | Failure: successor must have a fresh service-owned run identity. |
| Set old work to maxWork and create successor with copied options. | Successor resets work to zero and copies the same allowance with no new grant recorded. | Missing explicit budget-admission evidence: continuation must not look like an automatic allowance reset. |
| Simulate a permanent mock action failure after both parallel branches dispatch. | Run becomes `blocked`; both child records remain `running`, no sibling cancellation request. | Model limitation: current failure handler does not establish ADR's stop/cancel/account-for-effects guarantee. The injected unsupported action is not a normal publishable fixture; add a supported adapter-failure injection or clearly leave this guarantee untested. |

Useful existing safeguards from the initial inspection: occurrence paths serialize structural arrays (including loop iteration and item key), avoiding delimiter collisions; retries preserve occurrence inputs and use a new attempt ID; call admissions charge total work; human commands compare payload as well as ID; approval publication verifies a canonical request answer rather than trusting only an `approved` boolean; provider state is a separate object suitable for surviving Execution snapshot/restart. These safeguards need scenario evidence before being promoted to a broad conformance verdict.

A full cross-context saga is not present in this early model: the exported `reply` directly records the accepted answer in Execution state. Separating Knowledge save from `observe` does demonstrate one important ownership/ordering distinction, but does not by itself validate Human Interaction outbox/redelivery, Execution inbox acceptance or their crash atomicity. Frame those as required durable-substrate work unless subsequently modeled.


### Authoring/runtime integration counterexamples

After `authoring.js` and `scenarios.js` became available, two further executed probes found gaps that a green scenario list would otherwise hide:

- A definition accepted by `Authoring.validate` with `policy.totalWorkBudget = 1` started with runtime `maxWork = 100` and had already spent three calls while still running. Runtime admission ignored the declared definition policy. The effective work and concurrency allowances must honor the tighter of package and admitted deployment bounds (or explicitly reject an incompatible request).
- The then-current feature happy-path scenario passed, but independently applying `Authoring.validateValue(record.output, Authoring.actions[record.action].outputs)` to every finished call rejected both `approveSpec` and `approvePublish` with `type_error at $value.manifestId: required property absent`. The runtime receipt output used `manifest`, while the canonical schema required `manifestId` and `receipt`. The interpreter was not using the authoring schemas at action boundaries.

Other fixture shape mismatches were visible by inspection: feature admission reused extra bug-only inputs, fan-out examples omitted the required task title, and `unreproduced` reply acceptance attached execution/request metadata to an output whose schema allowed only decision and evidence. Keep canonical request metadata separate from the typed action result where appropriate. Validate run inputs, resolved call inputs, and accepted action/composite/run outputs using the same profile; a standalone validator test does not validate a journey that never invokes it.

### Post-amendment review

The parent revised the model in response to the counterexamples. An independent rerun of `Experiment.runAll()` passed **24 scenarios and 87 assertions**. An additional pass applied the canonical output schema to every completed call record in every scenario's final trace snapshot: **zero schema failures**.

Resolved in that reviewed revision:

- Source-version high-water tracking prevents regressive/duplicate edit observation, including after retain.
- Retain after quiescing a writer enters explicit recovery; a verified original-input checkpoint reconstruction is required. Effect reconciliation no longer clears an unrelated paused-work recovery condition.
- Checks and review explicitly carry their specification identity; publication approval rejects mismatched spec or checkpoint evidence.
- Run/call/result boundaries use the authoring value validator; reply metadata and fixture schemas now agree.
- Effective work/concurrency limits honor tighter package bounds.
- A successor needs a distinct immediate predecessor identity and explicit new admission record; original bug baseline and working checkpoint remain distinct.
- A supported mock permanent-failure injection requests active sibling cancellation and prevents publication. Unknown external effects remain visible through cancellation/reconciliation.

Two final counterexamples were sent to the parent for correction or explicit limitation:

1. **Declared invocation allowance:** mock `discover` and `implement` action definitions still declared `maxAttempts: 1` and no retryable error class while the runtime's hard-coded safe-retry/reconstruction paths admitted another attempt. The loop/new-occurrence distinction and attempt identity traces were useful, but did not yet prove that the declared retry policy controlled invocation. Align the mock contract and runtime checks; real adapter retry certification remains outside the experiment.
2. **Implementation scope gate:** a document accepted by `Authoring.validate` changed only the implementation call's spec binding to revision `different` while retaining a canonical approved scope receipt for revision `1`. The runtime completed the implementation. Publication gates were protected, but the `implement` action was not checking its own `specApproval` receipt/scope. Require the same canonical receipt and exact manifest validation for the implementation operation.

The retained verdict boundary should be **behavioral conformance of selected traces in a disposable in-memory/snapshot model**. The experiment does not establish database crash atomicity, context inbox/outbox transactions, real provider idempotency, native harness pause/recovery, source-authority security, actual Git reachability or tenant authorization. These need explicit later adapter/substrate tests. The absence of a global Knowledge/Execution save barrier remains an intentional contract limit, correctly made observable.

### Final evidence and verdict

The final reviewed revision resolves both remaining findings. `validateScope` requires a canonical accepted, approved scope receipt and binds the implementation to the exact spec, run, definition and policy before dispatch. The new mismatch scenario rejects the previously accepted different-spec implementation. The pinned mock action contracts now explicitly declare their test-only retry classes (`mock_read_transport` and `mock_verified_reconstruction`) and two-attempt bounds; dispatch, retry and reconstruction enforce those declarations. Publication remains a one-attempt action whose lost receipt is reconciled rather than reinvoked.

Independent final rerun: **25 runtime scenarios, 89 assertions, zero failed scenarios**. Independent validation of every completed call output and every completed call's attempt count in all final scenario trace snapshots: **zero schema or declared-attempt-limit failures**.

**Verdict: retain the structured grammar with the narrow amendments discovered in this experiment.** No additional execution node is needed for the two starter journeys. The review has no remaining blocking finding within the exercised disposable-model boundary. Keep the limits above explicit; the sharp next decision is a context-owned durable-substrate/inbox-outbox fault-injection experiment under these same invariants, not selection of a familiar framework without evidence.
