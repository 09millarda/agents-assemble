# Runtime boundary: failure and trust review

Status: Research input to the single claimed Wayfinder decision #2. This note does not resolve an additional decision or specify implementation tickets.

Scope: a portable control plane, customer-controlled runners, multiple agent harnesses, Git worktrees, shared server documents, integrations, and environment configuration.

Evidence: the requirements supplied by the project owner and distributed-system failure analysis. Everything below is a design recommendation or a proposed guarantee to validate. No harness, tunnel, identity, secrets, or integration product capability has been verified in this note. In particular, native session migration, enforced context limits, cancellation, and equivalent controls across harnesses remain unverified.

## The boundary to preserve

The control plane should own durable coordination: versioned workflow definitions and documents, execution state, human decisions, runner assignments, and records of intended and observed external effects. A runner should own local processes, working directories, worktrees, and execution credentials. The web UI, CLI, and external channels should submit commands to the same application interfaces.

The project owner has resolved the execution and authentication boundary: users install an Agents Assemble CLI that starts a daemon and tunnel on their own machines or servers. The daemon invokes already installed harnesses using the user's existing native login and accounts. Harnesses may call their model providers directly. Agents Assemble implements no agent loop and copies or brokers no model credentials; its control plane makes or proxies no model-provider requests and performs no model authentication. On-device model weights are not required. Compatibility between the chosen adapter, existing installation and native login remains untested.

The server is still a sensitive system if it stores product specifications, source excerpts, execution transcripts, and integration messages. Keeping inference off the server does not mean the server receives no confidential material. Define an explicit data contract for each artifact and event instead of uploading arbitrary terminal output.

## Honest guarantees

| Area | Guarantee to target | Limit to state explicitly |
| --- | --- | --- |
| Authoritative execution state | One accepted current assignment generation; stale generations cannot mutate the owned execution aggregate. | This does not stop a disconnected process or revoke credentials it already has. |
| Event handling | Durable publication intent and at-least-once delivery; one logical state transition per consumer/message identity within that context's transaction. | Retention and replay policy bound deduplication. This is not end-to-end exactly-once execution. |
| Ordering | An explicit sequence and concurrency rule for each owned aggregate or stream. | There is no global order across bounded contexts or external services. |
| Recovery | Resume from a verified durable checkpoint on a compatible runner. | Unpublished files, process memory, in-flight tool effects, and unsupported harness state are not portable. |
| External effects | Idempotent dispatch where supported; otherwise durable intent, reconciliation, and an explicit unknown-outcome state. | A timeout does not prove that the remote operation failed. |
| Environment rotation | New eligible attempts receive the required environment revision; connected runners acknowledge refresh or restart policy. | Updating a secret record does not rewrite the environment of an existing process or invalidate a copied secret. |
| Human collaboration | Commands and approvals apply to named revisions and attempts. | A stale approval must not silently authorize materially different instructions or changes. |

## 1. Split-brain execution and fencing

Each assignment should carry an increasing generation scoped to its execution, an attempt identity, and a lease. Accept runner commands through a concurrency check that verifies the current assignment and lease in the same transaction that changes the execution state. Authenticate the runner separately; possession of an old assignment payload must not be sufficient authorization.

Lease expiry should stop acceptance of stale state changes. On connectivity loss, the runner should enter a bounded pause/termination policy and refuse new effects after its local safety deadline. The server remains authoritative about expiry; local monotonic deadlines and a safety margin can help the runner stop conservatively, but the protocol must tolerate clock skew, suspend/resume, buffered messages, and a runner that never stops.

That fence has important limits:

- A process with direct Git credentials can still push after its execution lease expires. Give attempts distinct working directories and publication refs. Use expected-current-ref checks and reconciliation at publication; do not have replacement attempts blindly overwrite a shared execution branch. Exact Git-host support and policy need verification.
- A process with a ticket-system token can still post a comment. Prefer external write intents mediated by a service that checks the current assignment and maintains an effect ledger. Reads and writes need different capabilities.
- An already accepted model request may continue consuming resources after cancellation. Record request and attempt correlation where available and treat cancellation as best effort until a provider-specific contract establishes more.
- A gateway can fence acceptance of new intents, but cannot undo a downstream request already accepted before revocation. A stale downstream result can still arrive after a new assignment exists.

Automatic takeover is safe only to the extent that prior effects are fenced, idempotent, or reconciled. When the old runner had uncontrolled write credentials or an effect's outcome cannot be established, pause the affected publication/effect boundary with a useful recovery action. Do not hide that uncertainty behind a generic retry button.

Worktrees isolate working directories; they are not the execution security boundary. Define separately how an untrusted skill is constrained from reading other worktrees, host credentials, sockets, or the runner's own identity.

## 2. Checkpoints are durable manifests, not branch names

A checkpoint should identify immutable inputs and outputs sufficient to reconstruct the next safe action:

- Execution, attempt, assignment generation, checkpoint version, and workflow-definition/package digests.
- Project and upstream identity, base commit, published checkpoint commit and ref, plus required non-Git artifact references. Large-file content and submodule dependencies, when used, need their own availability checks.
- Document revisions or content hashes, accepted human-answer revisions, approval scope, and the exact context selection supplied to the harness.
- Requested and actual harness/model settings, runner capability requirements, environment-profile revision references, and supported exported session state, if any.
- Completed effects, unresolved effect intents, and the last accepted execution transition.

Never put secret values into a checkpoint. The manifest names environment revisions and authorized references; the destination runner resolves credentials independently.

Publish and verify required Git and artifact content before advertising a checkpoint as resumable. A server record written before a successful push is an incomplete checkpoint, not proof of recovery. The inverse crash—push succeeded but the server acknowledgment was lost—must be recoverable through reconciliation and can leave a harmless orphaned checkpoint for later cleanup.

Do not assume a moving branch name still identifies the same content. Retention must preserve the referenced commit and artifacts for the advertised recovery period. A destination should verify repository identity, content availability, environment policy, and harness capabilities before accepting work.

The portable baseline is workflow checkpoint recovery: start a fresh compatible harness session using durable artifacts and explicit instructions. Exact continuation of terminal processes, model conversation state, and partially executed tools is a stronger capability that should be optional and advertised per adapter. Changing harnesses may require a fresh attempt or human decision when behavior cannot be preserved.

## 3. Shared documents and human decisions must be revision-aware

An active attempt should consume a stable input snapshot. Human edits produce a new document revision; they should not alter the meaning of instructions halfway through an attempt without an explicit update protocol. Store which document fragments or retrieval results were selected, so later retrieval changes do not silently rewrite the checkpoint's context.

Use optimistic concurrency for human edits and agent proposals. When an agent drafted against revision 7 and a person saved revision 8, expose a merge or reviewable patch instead of overwriting the newer document. Collaborative editor technology is a later decision; the durable revision and conflict contract should not depend on that choice.

Bind every question and approval to its execution, attempt, input revision, and requested action. An answer delivered through Slack, a ticket comment, or the web editor should resolve the same question identity. Deduplicate repeated delivery. Concurrent or late answers should produce a visible conflict or superseded response, not silently trigger two continuations.

Define what invalidates an approval. A cosmetic document edit need not always invalidate everything, but changed implementation scope, target repository, intended external write, or reviewed commit must not inherit approval by accident.

## 4. Environment distribution requires a trust model

Introduce an environment profile owned by the project or environment policy, with named variables, nonsecret configuration, secret references, a revision, and permitted runner identities. A newly assigned runner should resolve that profile without a person logging into each machine. This profile distributes project/runtime configuration; it does not distribute harness model-account tokens or replace the user's native harness authentication.

Recommended default: use a provider-neutral secrets-resolution port and let authorized runners obtain credentials from the configured authority. Prefer narrow, short-lived credentials when the authority supports them. The portable contract should support several secret backends; it should not require AWS identity or a particular hosted auth service.

A hosted encrypted-bundle fallback is possible, but its security properties are not decided by the word “encrypted.” Specify who can decrypt, how runner keys are enrolled and replaced, how access is recovered, and whether the service or its management UI ever sees plaintext. Do not promise end-to-end secrecy before that design is established. A fully local installation may place these components on one machine while preserving the same interfaces.

Rotation is a lifecycle, not merely a changed database row:

1. Publish a new profile revision or secret-reference version and an activation/revocation policy.
2. Connected runners invalidate the relevant cache and acknowledge the required revision.
3. New attempts resolve an allowed revision before starting. A stale disconnected runner cannot start new authoritative work when it reconnects without revalidation.
4. Running attempts either refresh through an explicitly supported mechanism or stop at a safe checkpoint and restart under the new environment. Restart must still respect unresolved external effects.
5. Revoke or expire old credentials at their authority when required. Runner de-enrollment and deletion of local cache entries do not revoke copies elsewhere.

Expose pending, applied, and failed refresh state. “Rotation complete” should mean the configured enforcement policy was met, not that an event was emitted. Inherited process environment is not remotely mutable; credentials already loaded by a child process or SDK need a separate refresh or restart contract.

Materialize local environment files only when the tool requires them; constrain permissions and lifetime. Keep secrets out of Git, artifacts, event payloads, diagnostics, and terminal recordings. Redaction reduces accidental disclosure but is not a defense against a deliberately malicious skill with secret access. Community votes and popularity do not grant execution trust.

## 5. Outbound connectivity and remote terminal access

Prefer runner-initiated authenticated outbound connections for command delivery and optional terminal streaming. Treat the connection as a transport: commands need durable IDs and acknowledgments, and reconnects need replay and deduplication. An open socket is neither a lease nor proof that the command completed.

Separate terminal streaming from durable execution. Losing a browser or tunnel must not delete execution state; reconnecting must not spawn an extra process merely because the client repeated “open terminal.” Terminal access is a privileged capability tied to the organization, runner, execution, and actor. Browser access must not become an arbitrary route into a runner's network or host shell.

The offline policy should be conservative and explicit: no new authoritative assignments, bounded local continuation only where allowed, and no unsupported promise of conflict-free reconciliation later. Fully local self-hosting can use the same protocol over loopback and continue while disconnected from the hosted service, provided its own control plane and dependencies remain available.

Untrusted ticket text, shared skills, repository files, and terminal output are data. They must not grant permissions, change tenant scope, select new secrets, or manufacture human approval. Transport signatures establish message origin; application authorization still needs a mapping from the external workspace/user to an allowed internal actor and action.

## 6. One Postgres installation, independent context transactions

Each bounded context should own its tables, repository interfaces, transaction boundary, outbox, and consumer bookkeeping. A context mutation and its outbox record belong in one local transaction. A consumer's inbox record and resulting owned-state mutation belong in one transaction. Insert a durable external-effect intent there; dispatch the network request afterward.

Do not include another context's tables merely because they are in the same database. Avoid cross-context foreign keys, shared mutable domain records, and direct joins on the command path that make future database separation a correctness change. Reporting and read projections can combine events or explicit APIs while remaining replaceable.

Ordering should be specified per aggregate/stream, with tenant-qualified identities, aggregate version, event ID, correlation, and causation. Duplicate events and out-of-order events are different cases. A deduplication table does not solve a missing predecessor. Choose gap handling, retry limits, quarantine, and operator recovery deliberately; do not silently skip a poison event when subsequent events depend on it.

A saga orchestrator should persist its own progress and issue commands to owning contexts. Completion comes from correlated responses/events, not from reading and updating their tables inside one transaction. Compensation can fail and is often a new domain action rather than an undo: a posted comment, sent notification, or consumed model request cannot simply be rolled back.

Durable timers and bounded retry schedules belong to execution state, not process-local timers. Classify failures into retryable, invalid input, unauthorized, unsupported capability, and outcome unknown. Repeatedly retrying the last category can create duplicate external work.

## Failure experiments for the next frontier

These are proposed experiments, not claims that the architecture has passed them. They are deliberately bounded probes for later research/prototype decisions rather than implementation tickets.

| # | Experiment | Evidence required |
| --- | --- | --- |
| 1 | Partition a runner, expire its lease, assign a replacement, then restore the old runner with delayed commands and skewed clocks. Attempt a push and ticket write from both. | Stale state changes are rejected. Report separately which direct downstream effects remained possible; mediated effects must not acquire fresh authorization from a stale generation. |
| 2 | Let an external system accept a write, then drop its response and crash the dispatcher before completion is recorded. | Recovery reconciles or uses a verified idempotency key. Unsupported cases become visibly outcome-unknown rather than silently retrying. |
| 3 | Crash checkpoint creation before push, after push, and after manifest commit; remove destination access to one required artifact. | Only complete, reachable checkpoints are offered for recovery; incomplete/orphaned records are discoverable, and missing dependencies block resumption with a specific reason. |
| 4 | Edit a specification while an agent proposes changes and two channels submit different answers to the same pending question. Replay an old approval. | No lost human edit, one deliberate continuation, preserved response history, and rejection or explicit review of stale approval scope. |
| 5 | Rotate secrets while one runner is offline and another has a long-running child process holding old credentials. Then de-enroll the offline runner. | UI reflects actual enforcement state; new work requires an allowed revision; old credentials are limited only by demonstrated refresh/revocation behavior, with no secrets in captured logs. |
| 6 | Run a deliberately hostile community package that attempts to read host credentials, neighboring worktrees, and the runner's control identity. | The chosen isolation and capability policy is demonstrated, and any permitted access is visible before execution. Metadata, popularity, and prompt instructions are not treated as containment. |
| 7 | Reconnect two terminal clients, replay “open terminal,” and try cross-organization runner IDs and forged approval instructions in a legitimate ticket body. | Reconnect does not duplicate execution; tenant and actor authorization is checked at each access; content cannot grant capability or approval. |
| 8 | Deliver duplicate, reordered, missing, and poison events while crashing the consumer between inbox insertion, state mutation, and acknowledgment. | One logical owned-state transition; the transaction is atomic; ordering gaps and quarantine are visible and recoverable without a cross-context transaction. |
| 9 | Crash a multi-context saga after a resource is created but before acknowledgment, then make its compensation fail. | Durable progress allows reconciliation; no success is announced early; leaked resources and failed compensation remain attributable and actionable. |
| 10 | Resume a checkpoint on a runner with a different harness/version, unavailable model settings, and no native session importer. | Capability negotiation blocks unsupported promises or explicitly selects fresh-session checkpoint recovery. The actual model/runtime settings and any lost continuity are recorded. |
| 11 | Start the installed Agents Assemble CLI daemon under its intended OS user identity and background-service mode; invoke an already installed harness with a working native login, then expire that login and recover through native reauthentication. | The daemon uses the existing account without separate model API keys, copying tokens or service-side model authentication. Missing identity/session access produces an actionable local-authentication state. Adapter and account compatibility must be demonstrated for each supported harness. |

## Questions this review leaves open

- Which downstream writes must be mediated, and where are direct runner credentials an accepted weaker guarantee?
- What local process/container boundary makes community packages safe enough for the intended permissions?
- What is the first supported checkpoint/recovery contract across real harnesses?
- Which secret authorities and rotation enforcement policies form the portable baseline?

These questions should feed the canonical Wayfinder map. They do not each require a new ticket until the parent runtime-boundary decision makes a sharp investigation possible.
