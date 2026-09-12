# ADR 0002: versioned playbooks and action execution

Date: 2026-09-12  
Status: **Accepted baseline for #3; grammar retained with #6 amendments after bounded behavioral simulation. Production durability and adapter conformance remain unvalidated.**  
Decision: [#3](https://github.com/09millarda/agents-assemble/issues/3), amended by [#6](https://github.com/09millarda/agents-assemble/issues/6) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)  
Depends on: [ADR 0001](0001-control-plane-and-runners.md)

## Decision and scope

Use one declarative, versioned JSON document as the portable playbook representation. UI editing and a local TypeScript builder produce the same document. A playbook composes typed, versioned actions using structured control flow. Execution records immutable definition/input bindings, durable human waits, logical action occurrences and their invocation attempts. Harnesses execute agent actions on customer daemons under ADR 0001.

This selects architecture semantics and a grammar to test. It does not ship a schema, interpreter, TypeScript SDK or visual editor, certify a harness, choose a durable workflow framework, or decide the first release. Examples below use an illustrative YAML rendering of JSON data, not a promised YAML import feature.

Two owner preferences were requested during discovery. The working defaults are a fixed outer workflow with bounded adaptation, and pausing for review when a referenced specification changes. No answer was received before recording this decision, so these are explicitly selected architectural defaults, not owner-confirmed preferences. They can be amended by a later decision. The #6 simulation exercises their behavior, not owner preference or production conformance.

## Vocabulary and version identity

| Term | Contract |
| --- | --- |
| Playbook | Reusable definition with typed inputs/outputs, a structured body, dependencies and policy declarations. |
| Action definition | Reusable agent, human, integration or deterministic operation with input/output schemas, effect class and requirements. A workflow node calls an action definition. |
| Skill | Instructions/resources consumed by an agent action; not an executable workflow, permission grant or runtime profile. |
| Runtime profile | Versioned requested harness, model, effort, context-selection policy and required capabilities. Deployment bindings resolve a profile slot before run admission. |
| Run | Execution of a frozen definition manifest and initial input manifest. A linked successor is a new run with recorded lineage. |
| Occurrence | One logical activation of a node, identified by run, node path, enclosing loop iteration and map item key. |
| Attempt | An invocation of an occurrence. Retrying retains occurrence identity; a review/fix iteration creates new occurrences. |
| Artifact / checkpoint | Immutable content revision / verified recovery record as defined in ADR 0001. Mutable artifact heads and Git branches are not pinned inputs. |
| Human request | Durable question, review or approval with a target manifest, response schema, current version and authorized responders. |
| Stage | Display grouping only; it grants no execution or transaction semantics. |

Separate `formatVersion` (grammar), package identity/version (author release), and immutable content digest (exact content). Publication resolves and locks the package dependency closure: action definitions, skills/resources, child playbooks if supported, schemas and any shipped runtime profiles. Runtime slots pin capability constraints and any supplied defaults; organization-selected concrete profiles and their dependency closures are resolved and frozen separately at run admission. A version label alone is insufficient; republishing different content at the same immutable identity is rejected. Ranges and aliases may help author drafts but never remain unresolved in a run.

The run manifest also freezes effective defaults, expression semantics version, execution policy, environment-profile bindings and artifact/code inputs. Deployment bindings and current credentials are never packaged as public content. Secret rotation may change authorized secret versions under ADR 0001; record each attempt's receipt rather than claiming secret bytes are permanently frozen. Registry access is unnecessary after the dependency closure is imported and verified locally.

## Portable grammar and authoring

An illustrative document contains `formatVersion`, `package`, `inputs`, `outputs`, `dependencies`, `runtimeSlots`, `permissions`, `policy`, `body` and optional `presentation`. The following node kinds form the first grammar:

| Node | Meaning and bound |
| --- | --- |
| `call` | Invoke a pinned action alias using explicit bindings; validate accepted input and output. |
| `sequence` | Execute children in declared order; later children see only accepted earlier results. |
| `choose` | Evaluate ordered, pure boolean cases; execute the first match or required `otherwise`. Persist the selected branch; its declared output becomes the choice output, with the same output contract across all returning branches. |
| `parallel` | Start a finite declared set of named branches, with `join: all` and an explicit concurrency limit. Return results by branch ID, not completion order. |
| `forEach` | Snapshot a validated finite array once, require unique stable item keys, `maxItems` and `maxConcurrency`, then invoke a fixed body for each item. Its `output` binding is evaluated once per completed item against that item body's accepted results, then aggregated into an array in snapshot order. |
| `repeat` | Execute its fixed body at least once, then evaluate `until`; use explicit initial/carried values and a positive `maxIterations`. Exhaustion suspends with `limit_reached`, never reports success. |
| `end` | End the enclosing run with an explicit domain outcome and typed result. Used outside concurrent branch bodies; nested early exit cannot silently abandon siblings. |

No arbitrary jumps, recursion, graph mutation, detached branches or first-winner races in this grammar. `forEach` handles agent-generated task data without permitting generated node definitions or privilege changes. A package can declare stricter bounds; deployment policy may reject excessive ones. Bounds and counters survive restarts and attempts. Run admission also grants a total work/concurrency budget and any enforceable spend limit; nested bounded constructs cannot multiply work beyond it. An adapter lacking enforceable cost limits cannot advertise them. Exhaustion pauses for explicit new authorization, not an automatic counter reset. This is a contract choice, not a permanent exclusion of richer composition from the destination.

Each node has a stable author-chosen `id`, unique within its structural scope. Bindings use explicit `literal`, `ref`, `object` or `array` forms. A `ref` consists of a lexical source and an RFC 6901 JSON Pointer: run inputs, accepted earlier sibling output, immutable snapshots of lexically visible ancestor results/inputs, current item, or explicit repeat carry. Inner IDs may not shadow visible IDs; references cannot escape into a non-ancestor scope. Composite nodes publish only declared output bindings. An empty sequence returns an empty object unless it declares an output from available lexical bindings. A `choose` exposes the selected branch output; all returning branches must conform to the same declared shape, while `end` does not return. A branch cannot read a concurrently changing sibling, a skipped branch, an unbound optional value or a previous iteration implicitly. Missing paths and type mismatches are visible `binding_error` outcomes, never coerced to null, empty text or false. [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901).

Conditions are an explicit AST of `eq`, `not`, `all`, `any` and `exists` over bindings. Equality uses JSON value equality without string/number coercion. `all`/`any` evaluate in order with short circuiting; `exists` tests path presence without fetching external data. Objects ignore member ordering; arrays preserve it. Bound expression depth, size and evaluation cost. There is no time, randomness, network, filesystem or user JavaScript in conditions. A later expression-language expansion needs versioned semantics and editor support.

Inputs/outputs use a supported JSON Schema 2020-12 profile. Resolve references only from the pinned package closure; do not fetch schemas from author-provided URLs at execution. Reject unsupported schema vocabularies/keywords visibly at publication. Validate values at boundaries even when TypeScript says they are typed; arbitrary schema-to-schema subtyping is not assumed decidable. Artifact references and checkpoints have platform contracts as well as JSON shape validation: authorization, tenant ownership, existence and reachability require application checks. [JSON Schema Core](https://json-schema.org/draft/2020-12/json-schema-core).

The TypeScript builder runs in the author's local development environment and emits data. It may use local computation to construct that data; no function, closure, module import or executable callback crosses into the hosted interpreter. Published output, not TypeScript source or its build reproducibility, is authoritative. A UI may export generated TypeScript representing the document; it need not reconstruct comments, loops or abstraction choices from original author source.

For supported features, import → UI edit/export → import preserves normalized semantics, node IDs, dependency pins and policy. Normalization preserves ordered arrays and materializes defaults; the precise digest/canonical-byte algorithm is a later wire detail. Unknown required format/features block execution and editing, with raw export preserved. Namespaced non-semantic metadata can be preserved opaquely, but an unknown behavioral field is never treated as harmless metadata. The UI displays every behavioral field or routes it to a lossless structured editor; silent omission is a defect.

## Actions, capabilities and permissions

| Kind | Execution boundary | Required behavior |
| --- | --- | --- |
| `agent` | Customer daemon controls a configured existing harness. | Pinned skills/context, required native-account mode, validated typed outcome, checkpoint/provenance and requested/effective settings. |
| `human` | Durable service request; no runner/process must stay alive. | Typed reply, responder policy, explicit timeout/escalation and manifest binding for approval. |
| `integration` | Service integration adapter by default. | Scoped operation intent, current authorization, stable effect identity and provider reconciliation contract. |
| `deterministic` | Declared runner or service adapter. | Typed adapter operation; customer shell/build/check commands run on the runner. A package cannot upload code for execution in the control plane. |

An action declares its effect class (`read`, `workspace_write`, `external_write`), retryable error classes, maximum attempts, attempt timeout and cancellation behavior. Its declared executor and semantic adapter version are pinned; actual compatible installed versions are recorded. Application outcomes such as `needs_information`, `not_reproduced`, `changes_requested` and `rejected` are typed successful results which select explicit branches, not transport exceptions to retry.

Agent runtime slots are resolved before run admission to exact requested profile revisions. Capabilities are checked at publication where possible, at admission against deployment policy, and immediately before dispatch against the selected runner. The adapter must demonstrate the configured account-authentication mode, harness/interface compatibility, required structured outcomes, human interaction, and any requested interruption/resume features. A missing or expired local login reports `reauthentication_required`. An unsupported model/effort/context constraint reports the specific incompatibility and leaves work blocked for a compatible runner or explicit new configuration. Never silently substitute settings.

Record context as selected artifact revisions, Git checkpoint, skills and explicit prior results with a declared budget/overflow policy. A requested token budget does not change a model's physical context window. Either satisfy a required capability or reject it. An explicitly allowed compaction/truncation policy records what was supplied and the effective adapter behavior; mandatory context cannot silently disappear. Typed structured output does not require every harness to expose the same native API: an adapter may validate a result artifact where that fulfills the declared capability, with conformance still to prove.

Packages declare required logical permissions: repository/workspace access, artifact read/write sets, integration operations, network access and named secret bindings. Import/discovery/votes grant nothing. Organization policy and a run initiator's authority grant a concrete subset at admission; each operation also obeys current revocation policy. If grants cannot satisfy required permissions, reject admission. Dependencies cannot widen permissions beyond the reviewed package closure. A changed dependency/permission set requires a new version and grant review.

Credentials, private artifacts, deployment connection IDs, provider paths and environment values are not exportable package content. Instructions are untrusted inputs, not authorization. Daemons with unrestricted ambient shell/network/credentials cannot honestly enforce narrow package permissions: advertise actual enforcement capability, require an explicitly allowed trusted-runner mode, or reject the package. Worktree separation is not a sandbox. Detailed runner isolation remains a separate decision; this contract requires the difference to be visible.

## Durable execution, retries and cancellation

Execution owns occurrence identities, selected branches, loop counters, map snapshots, accepted input/output manifests, timers, assignment generations and state transitions. Accepted node outputs are immutable. An attempt captures its resolved inputs before dispatch; retries never silently rebind `latest` artifacts or pick a new model. A runner loss may require a fresh native session reconstructed from a verified checkpoint, not native transcript migration.

Retries preserve logical effect identity within the occurrence. Each declared effect slot has an identity derived from run + occurrence + slot; retries reuse it, while new remediation iterations use new occurrences. An invocation attempt has a separate ID for diagnostics and fencing. A changed payload under an existing effect key is a conflict, not an idempotent retry. Partial action progress and multiple effects need stable slot identities and receipts before an adapter can advertise retry safety.

Timeout, disconnect or lease expiry can mean `outcome_unknown`. Reconcile an existing external intent before replaying it. Provider idempotency, receipt lookup and expected-ref checks may make retry safe; otherwise suspend for recovery. Workspace writes also need checkpoint inspection/reset/reconstruction or an adapter-defined safe retry, never an assumption that the workspace stayed untouched. Default automatic retries are zero unless the action declares and proves a safe class. Automatic retries are bounded and persist their backoff deadlines.

On a branch failure, stop scheduling new work in that composite, request cancellation of active siblings, retain completed outputs and wait until their effects are accounted for. `parallel`/`forEach` cannot succeed with missing, failed or unknown branches. Concurrent reads may share immutable inputs. Concurrent workspace writers require separate worktrees; their results are integrated and checked by an explicit later action. No hidden concurrent writes to one worktree or last-writer-wins artifact merge.

Cancellation transitions through `cancel_requested`; it prevents new dependent dispatch and asks adapters to stop. Confirmed cancellation of controllable work and unresolved external effects remain separately visible. The run cannot claim clean cancellation while an operation may still publish. Compensation is an explicit domain operation/new action, never an automatic transaction rollback. Direct credentials on a lost daemon retain ADR 0001's weaker external-effect guarantee.

Human waits persist without leases on scarce runner resources. A deadline can expire/escalate a request according to policy; elapsed time never means approval. Duplicate replies with the same command ID are idempotent; competing replies use the request/manifest version and return a visible conflict. Unanswered questions, `limit_reached`, invalid results, permission changes and unknown effects have explicit blocked/recovery states rather than manufactured success.

These semantics require durable state, timers, idempotent messages, bounded scheduling, logical effect records and reconciliation. A queue plus ephemeral callbacks is insufficient. The original candidates were a context-owned PostgreSQL state machine, a durable workflow runtime behind a port, and a compatible declarative interpreter. [ADR 0003](0003-durable-execution-and-recovery.md) subsequently selects Execution-owned PostgreSQL transitions and context-local workers after a reduced fault experiment. Its acceptance transactions preserve the local inbox/outbox and saga ownership from ADR 0001; no global workflow transaction writes multiple contexts' tables.

## Artifact edits, human approval and continuation

An approval targets an immutable manifest: exact artifact revisions, proposed operation, reviewed code commit when applicable, definition/version and relevant policy. A spec approval and permission to publish a PR are distinct gates. A gate admits only the effects it names; it does not authorize later expanded scope or unlimited retries. Checks and review must refer to the same commit that the publication gate targets.

Execution freezes the gate manifest and version. Human Interaction records an authorized response; Execution accepts it conditionally against the still-current manifest/version through the saga. Adoption of a changed input and acceptance of approval are serialized within Execution's ownership boundary. A stale reply remains auditable but cannot approve a superseding manifest. No transaction spanning Knowledge, Human Interaction and Execution is assumed.

A Knowledge save creates a new revision, not an overwrite of the revision consumed by an attempt. A save against a stale base returns a conflict or a reviewable proposal. The default policy observes edits to an active run's referenced specification and marks the run `replan_required`: stop new dependent work, request an active writer to pause at a supported safe checkpoint, and reconcile any uncertain effects. A draft save is not an atomic global execution barrier; the UI shows whether Execution has observed/accepted the change. A strict stop requires an acknowledged pause through Execution.

At the pause, an authorized person can explicitly retain the existing revision for this run, or adopt the new revision. Retaining acknowledges the exact observed proposed revision and existing pinned revision against the current Execution version, and leaves the original manifest binding intact. It does not acknowledge all future edits. Adoption supersedes affected approvals and creates a linked successor run with the revised artifact and a verified checkpoint as explicit inputs. The old run is marked superseded only once its controllable work is quiescent and effects are reconciled; an uncertain old publication blocks continuation at that boundary.

Follow-up from owner-approved #4: the [first release contract](../first-release-contract.md) distinguishes durable live Markdown/graph draft edits from explicit submission of an execution-relevant revision. The pause/retain/adopt rules above apply to the submitted revision after observation, not to every keystroke. #12 will validate the submission, ownership and concurrency contract.

The successor also inherits an explicit service-owned delivery identity and external-resource mapping, so new operation identities do not accidentally create a second PR for the same logical change. An adapter reconciles or updates that mapped resource under its own effect protocol. The successor starts its playbook at entry. Its actions can consume prior discoveries/code as inputs and review what remains, but previous successful nodes or approvals are not automatically copied as completion. This provides a simple explicit replan path without in-place graph mutation, selective rewind or rewriting history. The UI can present the lineage as a continuous work item. Selective replay within one run is deferred until there is evidence it is needed.

## Worked definitions and rejection cases

The [shared example conventions](../examples/playbook-contract.md) define pseudonotation and action contracts. [New feature](../examples/new-feature.playbook.md) and [bug fix](../examples/bug-fix.playbook.md) illustrate human questions, pinned spec approval, bounded review/remediation, a parallel verification join and explicit publication approval. Placeholder dependency names and runtime slots are deliberate; these are designs to test, not installable community packages or certified adapters.

| Scenario | Required observable outcome |
| --- | --- |
| Draft edited or package version superseded during an active run | Active run keeps its immutable package manifest; adopt through an explicit new run. |
| UI does not understand a behavioral field | Preserve original export; block edits/execution with a named unsupported feature. |
| Runner lacks requested effort/native login/output capability | Block that dispatch with a capability explanation; no setting substitution. |
| Human edits spec while agent saves from an older revision | Preserve both revisions/proposal; expose conflict, then checkpoint/replan policy. |
| Old approval reply arrives after revision adoption | Reject for superseded manifest; require approval for new manifest. |
| Provider created PR but acknowledgment was lost | Reconcile stable operation identity; do not create a second PR. |
| Cancellation races with a Git push | Record requested stop and actual/unknown effect independently; reconcile before successor publication. |
| Bug cannot be reproduced or a check fails | Follow a typed investigation/remediation branch; never report verified success. |
| Review keeps requesting changes | Exhaust bounded iterations into human attention, preserving evidence. |
| Restart during task fan-out or a human wait | Resume persisted membership/wait state; no duplicate task expansion or fabricated answer. |

## Alternatives and consequences

Arbitrary TypeScript workflow execution gives author flexibility but cannot guarantee complete visual editing or portable replay without a larger execution/trust contract. A DAG alone cannot directly express bounded repair cycles. An arbitrary mutable graph makes approval scope, replay and editor behavior harder to define. A skill-only model cannot represent durable human and integration actions. The structured document pays for portability with a deliberately limited grammar and explicit adapter contracts.

The open workflow specification provides useful examples of declarative tasks, forks and loops, but adopting its full language would add semantics beyond the two starter journeys. Its existence supports comparing a subset/interpreter later; it does not by itself prove conformance to this contract. [Open Workflow specification](https://github.com/open-workflow-specification/specification/blob/main/dsl-reference.md).

## Conformance amendments from #6

The [disposable conformance experiment](../research/playbook-conformance.md) retains the seven-node grammar and both starter journeys. It passed 25 authoring probes, 25 runtime scenarios with 89 assertions, and an independent full-feature TypeScript builder/document round trip. These are simulated behavioral results with mock adapters and JSON restart snapshots, not proof of production persistence, account compatibility or a complete schema/editor implementation.

- Persist an artifact's source aggregate version and observation/deduplication history independently of its pending edit. Older/duplicate events cannot replace a newer proposal or repeat an acknowledged pause. Opaque revision IDs are not ordering numbers; later source versions still require review, and production consumers must reconcile gaps.
- Validate canonical accepted approval receipts at the effecting boundary. Implementation checks its exact spec/operation/definition/policy scope receipt; publication checks its exact spec/commit/delivery manifest. Checks and review explicitly carry both spec and checkpoint. A schema-shaped approval value grants no authority by itself.
- Keep workspace reconstruction, unknown effects and cancellation accounting as distinct recovery obligations. Retaining a revision does not resume a stopped writer automatically. Reconciliation of one effect cannot clear a different recovery obligation; a verified reconstruction permits another invocation only under the pinned adapter's declared class and bounded attempt/work grant.
- Package limits cap admission grants. Charge retries and reconstructed invocations, persist counters, and require an explicit new admission/grant and unique run identity for a successor. Adoption alone does not replenish an allowance.
- A failed branch requests sibling cancellation and blocks dependent dispatch. All-join completion requires successful members and accounted effects; missing/failed work cannot disappear during recovery.

The experiment's mock receipt lookup, trusted authorization/checkpoint boundaries and deterministic steps do not prove cross-context inbox/outbox delivery, lease fencing, durable timers/backoff or crash atomicity. The next technical decision must test those boundaries with real persistence and fault injection.

## Next frontier and remaining fog

Resolved [prototype decision #6](https://github.com/09millarda/agents-assemble/issues/6): retain the grammar with the amendments above. [Decision #7](https://github.com/09millarda/agents-assemble/issues/7) and [ADR 0003](0003-durable-execution-and-recovery.md) add the PostgreSQL acceptance/recovery protocol and [bounded persistence evidence](../research/durable-execution-conformance.md). Retaining a spec keeps its original approval scope; an unresolved wait invalidated by observation needs an explicit replacement request and fresh response. Stopped-writer acknowledgments are fenced, reconstructed invocations are charged once at admission, and replayed effect acceptance does not authorize a second external call.

Remaining fog: production schemas and adapter/wire versions; canonical bytes and signing; scheduler/library selection and full interpreter persistence conformance; detailed saga protocols and recovery UI; selective replay; nested playbook recursion/composition beyond fixed action reuse; large-scale scheduling; actual harness conformance; runner isolation; editor technology and package registry governance. First release #4 is resolved in the [release contract](../first-release-contract.md); license/parity remains #5. Decisions #12–#15 address the newly selected collaboration, conversation, community and deployment boundaries.

Research inputs: [authoring](../research/playbook-authoring.md), [execution failure review](../research/playbook-execution-review.md), and [conformance experiment](../research/playbook-conformance.md). The first two supported #3; the third records #6's evidence, initial failures, corrections and limits. Production schema/interpreter, harness and persistence conformance remain unproved.
