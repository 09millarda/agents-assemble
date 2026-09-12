# Review of the minimum playbook execution contract

Date: 2026-09-12  
Decision support: [#3](https://github.com/09millarda/agents-assemble/issues/3)  
Status: design proposals and failure analysis; no implementation or recovery experiment has been run.

This review applies the [product charter](../product-charter.md), [domain context](../../CONTEXT.md), accepted [control-plane and runner boundary](../architecture/0001-control-plane-and-runners.md), and existing [runtime failure review](runtime-failure-review.md) to the feature and bug-fix journeys. It recommends execution invariants, independently of a workflow framework. These are architectural proposals, not facts certified by a vendor or evidence that a particular engine satisfies them.

## Recommended shape

Use an immutable, schema-versioned declarative definition with structured control flow. A run pins that definition and its transitive action, skill, and runtime dependencies. Give an action typed inputs and outputs; let its result describe domain outcomes such as `unreproduced` or `changes_required`. The engine interprets that result through declared control flow.

The minimum useful constructs are action invocation, sequence, choice, parallel-all, bounded repeat, and bounded for-each. A stage is presentation metadata. Do not add arbitrary graph mutation, unbounded cycles, detached children, first-success races, unrestricted evaluation, or implicit compensation to satisfy the starting journeys. A TypeScript authoring API can emit this representation; its host program is not code uploaded for execution by the control plane.

| Construct | Minimum execution rule |
| --- | --- |
| Action | Resolve a pinned reusable definition, bind typed inputs once, record its occurrence, and execute according to its declared kind and policy. |
| Sequence | Start the next child only after the preceding child has a successful accepted result. |
| Choice | Evaluate a restricted predicate over typed, persisted inputs/results. Persist the chosen branch once. An exhaustive case set or explicit default prevents silent fall-through. |
| Parallel-all | Persist the activated child set. Join succeeds only when every activated child succeeds; merge results under explicit branch keys. A failed child makes success impossible and initiates the declared sibling-stop policy. |
| Bounded repeat | Persist an iteration counter and named loop state. Run a fixed body until its declared result satisfies the stop predicate, or its iteration budget is exhausted. Exhaustion has an explicit outcome, normally human attention. |
| Bounded for-each | Snapshot a finite typed array, verify unique stable item keys and `maxItems`, and invoke a fixed child body with `maxConcurrency`. Persist membership before dispatch. An empty array succeeds with an empty result. |

Simple reference binding, constants, field access, equality, and enum cases cover these examples. Avoid making definition authors write arbitrary expressions to recover ordinary control flow. Exact serialization and expression syntax can be validated later without changing the above meaning.

## Identities: a loop is not a retry

There are at least four identities:

1. A **definition node** is the stable location in the immutable playbook.
2. An **action occurrence** is one logical activation of that node in one run. Its identity includes enclosing loop iterations and map item keys, preferably through a persisted opaque ID plus its structural path.
3. An **attempt** is one invocation toward completing that occurrence. Recovery may create another attempt; only one authoritative assignment generation is current.
4. An **effect operation** identifies one intended external operation. Its identity survives retries and is distinct from the network delivery or attempt that performed it.

For example, `review-loop[0]/review` and `review-loop[1]/review` are different occurrences. Retrying `review-loop[0]/review` after a runner failure produces a second attempt of the first occurrence. A `changes_required` result is a successful review action whose business result selects remediation; it is not an execution failure that the retry policy should handle. The next review consumes the new confirmed code revision and must have a new occurrence.

Likewise, `reproduction.result = unreproduced` is a valid result. A bug-fix definition must take a declared investigation or human-decision branch. A process error, malformed output, unauthorized operation, unsupported capability, or missing required result cannot manufacture `reproduced` or advance to remediation.

Retry policies classify errors and include finite attempts, persisted deadlines/backoff, and an action repeatability contract. Schema failure should be visible and bounded; it is not permission to run an unconstrained output-repair agent forever. A retry preserves the logical purpose and frozen input binding. A resumed invocation can additionally consume an explicitly recorded checkpoint or human-answer receipt; silently substituting newly edited task instructions is a change of work, not recovery.

A run-level bound should also limit the total work authorized across loops, maps, and retries. Per-node limits alone can multiply into unexpectedly large execution. Limits must remain enforceable after a restart.

## Human waits and concurrent edits

A human action creates a durable canonical request and waits for an authorized response. It does not hold a worker process or a database transaction open. Every delivery surface refers to the same request ID, response schema, expected request version, and scope. Repeated delivery is idempotent; competing answers either lose the concurrency race visibly or require explicit resolution. A late answer to a superseded request is history, not a second continuation.

An agent's unexpected question should use the same request mechanism, correlated to its occurrence, current attempt, and relevant input/context. Do not confuse a product question with a native harness tool-permission prompt. The adapter must advertise whether it can pause and deliver an answer to the same process. A replacement runner may instead use a supported checkpoint and a fresh attempt carrying the recorded answer; exact process/session continuation is optional. An old process must not receive fresh authority merely because its old question was answered.

An approval authorizes a particular proposal. Freeze a manifest identifying at least:

- Run and gate/request identity, proposal version, requested operation, and target resources.
- Relevant document and artifact revisions, including the specification and implementation plan where used.
- Reviewed Git commit or patch digest for approval of code publication.
- Relevant permission/policy scope and the intended effect parameters when approving an external write.

The effect or downstream dispatch must consume that scope, rather than checking for an unqualified boolean called `approved`. A chat message saying “approved” cannot select its own run, revision, actor, or authority. The integration mapping and current application authorization decide whether it is an eligible reply.

Knowledge owns artifact revisions; Execution owns adopted run inputs and the proposed operation manifest. Keep this boundary explicit. Saving document revision 8 is not a transactionally atomic revocation of a gate in Execution. Serialize gate approval and input adoption using the Execution aggregate's expected version. An approval can authorize the pinned revision even if a newer unadopted Knowledge revision exists; the UI must show the revision actually authorized and any known newer proposal.

Recommended conservative edit behavior, subject to the user's product choice: after observing a relevant edit, stop new dependent dispatch and ask active work to pause at a safe checkpoint. The user can explicitly retain the old pin, acknowledging the exact known revision proposal, or adopt the changed scope. A future unrelated edit must not inherit that acknowledgment. The initial contract should invalidate affected approval when its adopted input scope changes, without attempting a semantic classifier for “cosmetic” edits.

### A smaller model for adopted changes

Adopt changed work into a **linked successor run**, starting at the definition entry with the revised artifacts and any verified checkpoint supplied as explicit inputs. Do not add selective graph rewind, mutation of completed occurrences, or edits to an active run's pinned definition to the first contract.

This is coherent provided that:

1. The predecessor remains an honest immutable history. The successor cannot claim it executed the predecessor's completed actions.
2. A definition that supports reuse declares checkpoint/prior-work inputs and decides how to use them at entry. A checkpoint reference does not implicitly skip arbitrary actions or prove their output contracts.
3. The predecessor is paused/stopped and fenced for the work being transferred. Its unresolved operations are reconciled before overlapping publication. Starting a new run is not a way to evade unknown effects.
4. Repository identity, checkpoint commit, external work item, and any existing PR mapping are carried explicitly. Otherwise a successor could accidentally create a duplicate resource or overwrite the wrong ref.
5. The successor evaluates its approval obligations afresh; predecessor approval is evidence, not a blanket grant for changed work.

An eventual read-set event may arrive after an old-scope operation was already dispatched. The system can report that ordering and stop future affected work; it cannot promise that an artifact save instantly stopped a disconnected runner or an already accepted external operation.

## Fork/join and dynamic task fan-out

Start with parallel-all and a finite for-each, both with structured lifetime. Persist branch/item membership before starting children; never reconstruct membership from a now-mutated array or a fresh model answer. Item keys identify work, while array position can preserve output ordering. Reject duplicate keys, oversize collections, or invalid item schemas before any child is dispatched. Do not silently truncate a plan.

A generated task list is data consumed by a fixed child definition. It cannot introduce new executable node types, expressions, actions, skills, permissions, runtime overrides, or integrations. A task item can carry a title, scoped instructions, and validated artifact references according to the declared schema. The child still runs within the pinned action's granted capabilities. An agent-generated graph would require a distinct versioning, validation, and authorization decision.

For the minimum fail-fast policy, the first terminal child failure stops starting queued siblings and requests cancellation of running siblings. The scope does not advance downstream while those children or their governed effects have an unresolved outcome. If the product later needs partial-result joins, quorum, or collect-errors behavior, make that a new explicit mode. Do not infer success from the disappearance of worker processes.

Parallel branches must not implicitly share a mutable artifact or working tree. Parallel research can produce separate immutable reports. Parallel code tasks need isolated worktrees/publication refs and an explicit subsequent integration action that consumes the exact branch commits and can report conflicts. Join merges result references, not Git changes or Markdown content. The feature starter can keep implementation sequential and still exercise useful parallel research.

The definition validator should reject unsupported cross-branch references and joins that depend on inactive choice branches. Structured lexical scope is sufficient; a general graph-cycle analyzer need not become part of the user model.

## Effects, cancellation, and uncertain outcomes

Prefer separate integration actions for governed publication: push or confirm a checkpoint, create/update a PR, synchronize a work item, and deliver a configured notification. This makes their operation scope and authorization inspectable. Native tools may have local effects within the workspace; externally writable credentials given to a harness remain an explicitly weaker boundary under ADR 0001.

An effect intent records the stable operation ID, target, parameters or digest, authorization scope, originating occurrence, and observed outcome. Reusing the ID with different parameters is a conflict. A restarted attempt must recover an existing operation from the ledger, not generate a new random ID for an uncertain previous request. Model-generated tool-call order is not a reliable replacement for logical operation identity.

For PR upsert, separate the identity of a request to update a PR from the durable mapping to the PR resource. Retries of one occurrence reuse its operation ID. A later occurrence may request a different update while targeting the same mapped PR. A linked successor run must explicitly inherit or resolve that mapping; neither a fresh run ID nor a retry count alone identifies the intended external resource.

Cancellation and lease expiry stop acceptance of new authoritative work; they do not prove the process stopped or the external write did not happen. Record separately the cancellation request, acknowledged process state, outstanding effect state, and whether the run needs attention. Clean cancellation should not be presented while these relevant outcomes remain unknown. A manual recovery decision must state what uncertainty it accepts instead of relabeling unknown work as a successful rollback.

When an effect times out, reconcile its stable identity with the external system or repeat only through a verified idempotency contract. If neither is available, pause the affected boundary and expose the intended operation and available recovery choices. Do not automatically create another PR or send another notification. Unrelated completed history remains valid. Compensation, if required by a playbook, is another authorized and fallible operation; no default transaction-like undo should be implied.

## Context and checkpoints

The context for an occurrence/attempt should be a manifest of immutable artifact revisions, selected excerpts or retrieval-result references, worktree/base commit, accepted human receipts, pinned skills, and requested/effective runtime settings. Retrieval is a materialization step; replay should not silently retrieve different text under the same named context input. Context truncation or unsupported harness settings must be visible and obey declared policy.

A checkpoint becomes usable only after required code and artifacts are published, verified, and retained under the promised recovery period. It binds this context manifest, the definition/run/occurrence/attempt, authoritative assignment generation, environment revision references, confirmed commit, and relevant effect outcomes. It contains no secret values. Starting an attempt on another runner resolves credentials anew and verifies available dependencies and capabilities.

Completion and checkpoint durability are different facts. An action may return a useful report without a resumable code checkpoint; an unpushed worktree cannot be advertised as portable. A checkpoint may preserve in-progress work without marking the occurrence successful. The baseline resumes from that durable work with a fresh compatible harness invocation; native session export/import is a separately verified capability.

## Walkthroughs that expose the contract

**Feature.** Intake produces a typed brief; parallel repository and domain research produce separate reports. A specification action writes a Knowledge revision and a human gate approves an exact proposal manifest. Planning produces a finite task list. A bounded for-each can inspect task feasibility, while implementation remains sequential in a confirmed workspace. A bounded implement/check/review loop carries the latest verified commit and findings as explicit loop state. A `changes_required` review advances the iteration; a failed test runner follows infrastructure recovery. Publication approves and consumes the exact final commit and PR target. A timeout creating the PR enters effect reconciliation with the same operation ID.

**Bug fix.** Investigation asks durable questions when needed. Reproduction returns `reproduced`, `unreproduced`, or `insufficient_evidence` with evidence references. A choice sends nonreproduction to an explicit bounded investigation or human decision. A justified decision to proceed can carry its rationale as an input; it must not rewrite the reproduction result. Remediation/check/review produces new occurrences for new code revisions. PR publication uses the same integration/effect contract as the feature flow. The engine needs no hard-coded feature-versus-bug branch.

## Failure scenarios the later prototype must exercise

| Scenario | Required observable result |
| --- | --- |
| Review returns findings three times. | Three distinct review occurrences; each consumes the corresponding commit; the configured loop bound eventually routes to attention. Attempt retry counts do not absorb the review loop. |
| A reviewer process crashes before reporting. | The failed attempt and replacement share an occurrence. Recovery starts from recorded inputs/checkpoint; no fresh commit or revised instruction is silently substituted. |
| Reproduction completes normally without reproducing the issue. | The persisted result remains `unreproduced`; the definition's explicit branch decides what follows. No generic success edge starts an unjustified fix. |
| Specification edit races with approval. | Gate/adoption expected-version rules choose one accepted transition. The approved manifest is inspectable; a later observed change causes a visible pending-change state. No claim of a cross-context atomic save barrier. |
| Web and chat send different answers simultaneously. | One deliberate accepted response; the other is a visible conflict or superseded response. Delivery replay cannot resume the run twice. |
| Human answers after the old runner loses its lease. | The answer is durable, but continuation is delivered only to the current authorized invocation or a checkpoint-based replacement. |
| A task array changes after two of five children start. | The persisted five-item scope remains stable. New input requires a new authorized scope/run; children are not silently added, removed, or reindexed. |
| Two task items have the same key or the list exceeds its bound. | Validation fails before dispatch, with a clear error. No accidental deduplication or truncation loses intended work. |
| A parallel child fails while another publishes an external effect. | Join cannot succeed; sibling cancellation and outstanding effects remain tracked. No automatic rollback or premature parent advance. |
| External PR creation succeeds but its response is lost. | Reconciliation finds the existing PR or the operation remains outcome-unknown. A blind new create is not scheduled. |
| Cancellation races with a downstream accepted request. | The operation may still complete and is recorded. UI distinguishes cancellation request from confirmed stop and settled effects. |
| A successor starts from revised scope while the predecessor has an unknown push. | Handoff/publication remains blocked until reconciliation; starting a new run does not bypass the ambiguity. |
| A runner dies before checkpoint push, or after push before manifest acknowledgment. | The first checkpoint is incomplete; the second is reconciled. Neither is called resumable without verifying the required content. |
| Recovery selects a runner lacking the requested account-compatible harness or context capability. | A specific capability/readiness failure; no silent model, login-mode, effort, or continuity substitution. |

## Remaining decisions

The subsequent prototype should demonstrate the identity, gate/adoption, structured control, and uncertain-effect behavior before an implementation substrate is selected. Exact schemas, harness wait/control capabilities, effect mediation guarantees, runner isolation, checkpoint retention, and authorization roles still need focused design or experiments. Broader graph operators and live run migrations can remain unspecified until a real starter journey requires them.
