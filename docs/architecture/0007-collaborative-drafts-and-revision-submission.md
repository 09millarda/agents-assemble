# ADR 0007: collaborative drafts and immutable revision submission

Date: 2026-09-12  
Status: **Selected bounded collaboration/submission profile; reduced conformance evidence, not a production editor or release qualification.**  
Decision: [#12](https://github.com/09millarda/agents-assemble/issues/12) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)  
Depends on: [release contract](../first-release-contract.md), [ADR 0002](0002-playbook-and-action-contract.md), [ADR 0003](0003-durable-execution-and-recovery.md)

## Decision

Select Yjs-based live drafts behind a collaboration adapter, with owner-local PostgreSQL acceptance and explicit immutable revision submission. Use shared text for Markdown and stable entity IDs with field-granular shared structures for graph authoring. Freeze server-recorded review candidates; an explicit submission names the exact candidate and expected submitted-head generation. Edits can continue without changing that candidate, any published revision, or a pinned run.

This selects a protocol and candidate substrate, not a production dependency lock, editor framework, WebSocket provider, complete graph representation or hosting topology. The experiment pins Yjs 13.6.32 and PostgreSQL 17.9 for reproducibility. [The comparison](../research/collaboration-substrate-comparison.md) considers only Yjs and centralized ShareDB operations. ShareDB remains a credible alternative if the later editor/graph experiment invalidates this selection; neither removes the application-owned publication and Execution boundary.

Yjs fits disconnected local editing and reordered update delivery. The cost is an explicit server durability, snapshot and provenance layer. Convergence settles shared values; it does not prove graph validity, user intent or approval. The [conformance report](../research/collaborative-drafts-conformance.md) separates actual library/database observations from controlled Execution, authorization and recovery fixtures.

## Ownership and visible states

| Owner | Authoritative records and behavior |
| --- | --- |
| Knowledge | Markdown draft epochs, accepted update history/receipts, review candidates, immutable artifact revisions and submitted revision events. |
| Automation Catalog | Playbook draft equivalents, semantic validation, pinned dependency closure and immutable package publication. |
| Shared collaboration adapter | Reusable encoding, transport and editor binding mechanisms. It has no independently authoritative cross-context document store or publication transaction. |
| Execution | Run subscriptions/observation cursors, pending input proposals, pause/recovery obligations, manifest-bound decision acceptance, predecessor/successor lineage and admission. |
| Human Interaction | Authorized answers and approval/retain/adopt requests; Execution separately accepts their relevance. |

Use explicit UI states: local/pending edit, server-durable edit, review candidate, submitted revision, Execution-observed proposal, pause requested/acknowledged, and retained/adopted decision. A transport sync indicator or cursor-presence update proves none of the later states. Submission acceptance is not a global stop barrier; the pinned run remains unchanged until Execution processes the proposal and its existing recovery protocol.

Publishing a Catalog package does not automatically replan every run using an older version. Publication supplies immutable inputs for future admission. Proposing a package change to an existing run is an explicit, authorized input-change proposal with its exact version/closure and target lineage; it then uses Execution's observation/adoption protocol. Referenced specification subscriptions likewise have declared relevance rules. Draft edits never broadcast implicit scope changes to all runs.

## Durable draft acceptance and provenance

Scope update commands by organization, owner context, document, draft epoch and operation identity. Bind the payload digest and authenticated principal. The owner validates current authorization, supported encoding and resource bounds before canonical application or broadcast, then atomically commits the accepted update bytes, monotonically increasing draft receipt sequence, audit record and command verdict. Acknowledge only after commit. A matching retry returns the stored verdict; differing bytes/principal under the same identity conflict. Recheck authorization before disclosing a receipt after revocation. An edit acknowledgment means durable acceptance, not a guarantee that the edit remains the visible winner after later/concurrent changes.

Reconnect retries original unacknowledged envelopes and receives missing accepted state. Persist dependencies even when an out-of-order CRDT update cannot yet integrate; expose that distinction and block review candidates until their required state is complete. Pin the adapter version handling pending update state; the experiment's internal pending-dependency inspection is not a promised public Yjs interface. A rejected local update cannot be repeatedly merged back through full-state synchronization: retain/export its proposal and rebuild the authorized replica from accepted state.

Attribution means a durable history of authenticated submitted edits/proposals, including actor, original envelope, accepted sequence and content/change references. A reconnect sender may carry other people's structures and must not become their attributed author. CRDT client IDs, transaction origins and presence names are not identities; native deletion metadata is not forensic authorship. Preserve ingress provenance separately, mark imported/unknown provenance explicitly and expose superseded/conflicting edits in history. The fixture verifies envelope attribution, not per-character attribution or production identity enforcement.

Presence is ephemeral, authorized and scoped to the document/session. It expires on disconnect and cannot grant edit or approval authority. Presence persistence, cursor anchoring, revocation propagation and browser-local durable pending queues still need adapter validation.

An agent supplies a version-aware proposal naming exact base epoch/receipt sequence and digest. Apply only if that base still matches under the source's transaction lock. Otherwise retain a reviewable conflict without altering newer human work. A human may explicitly merge the proposal against a new base with a new command identity. Do not silently apply a stale whole-document replacement as an ordinary live edit.

## Exact review candidate and submission

1. Flush the submitter's intended local updates and obtain their durable receipts. Missing/rejected dependencies or local unsent edits remain visible. Freezing a candidate does not promise to include disconnected collaborators' private pending edits.
2. Under the owner's draft cut, materialize an immutable review candidate containing document/epoch, accepted sequence, exact Markdown or normalized playbook bytes, content digest, validation profile/result, and recovery checkpoint/log references. Review displays these exact bytes and any difference from the current draft.
3. Submit the candidate with a stable operation identity and expected submitted-head generation. An older preview remains a valid deliberate submission if the submitted head still matches; later live edits remain pending draft work. A changed head produces a visible conflict requiring review and a new command.
4. In one owner-local transaction, commit the immutable revision, submission sequence, verdict and outbox event. Concurrent submissions against the same head produce one winner. Even identical content under different operation identities does not silently bypass head comparison. Retrying the winner returns its exact receipt.

Draft receipt sequence and submission stream sequence are distinct. A Yjs state vector is a synchronization hint, not revision identity: deletion can alter reviewed content while leaving it unchanged. Persist materialized revision bytes independently of CRDT garbage collection. The experiment uses sorted-key JSON and SHA-256 for its narrow values; it does not select the production canonicalization/signature format. Production candidates must bind normalization/schema versions and the complete accepted behavioral manifest, including dependency pins, policy and runtime requirements.

The submitted revision is an input proposal, not an approval. Retrying a previously rejected command preserves its rejection; a state change does not turn old rejected intent into an accepted submission.

## Graph integrity

The visual editor continues to represent ADR 0002's structured grammar, not an unrestricted executable graph. Stable IDs, explicit structural parent/order fields and field-granular shared types must preserve its semantic round trips. Yjs's deterministic winner for the same property is not a semantic merge dialog. Keep both accepted envelopes/history and surface conflicts that require review.

Allow representable incomplete drafts with visible diagnostics. Publication validates the full normalized definition and pinned closure: structured control flow, identity/reference scope, schemas/bindings, bounds, dependency/runtime requirements and unknown behavioral features. Dangling references, incompatible concurrent moves or unsupported fields block publication; do not silently repair them into different executable behavior. Rejection leaves the previous published version and every run manifest intact.

The reduced experiment exercises shared node records/order, competing values, dangling/orphaned nodes, action type and unknown fixture fields. It does **not** validate the full grammar, nested shared-field representation, complex moves, editor commands or JSON/TypeScript round trips. The subsequent [#16 decision / ADR 0008](0008-semantic-graph-collaboration.md) selects the bounded stable-entity/ordered-placement representation with actual nested round-trip and conflict evidence. It still does not certify the production editor binding or complete semantic validator.

## Execution observation, retain and adoption

Source events carry organization, owner context, artifact/package identity, source epoch/stream, submission sequence, immutable revision/digest and stable event identity. Execution admission starts from an authoritative subscription cursor matching its pinned inputs; it does not assume every new subscriber starts at sequence zero. Reconcile subscription changes and missing history through an authoritative source checkpoint/history contract. The fixture starts fresh single-source streams at zero.

Each Execution acceptance is a separate local transaction with its inbox verdict and state/outbox consequences. A future sequence creates an independent gap obligation and blocks unsafe continuation; contiguous source history advances the observation cursor. Duplicate events cannot repeat a pause, older events cannot regress the proposal, and reused identities/sequences with different content conflict. Multiple relevant sources maintain independent cursors and an exact combined pending decision manifest; the experiment covers one source per reduced run.

Observation pauses new dependent work and invalidates unresolved waits as in ADR 0003. It does not atomically stop a native writer or retract an accepted external effect. A retain/adopt response names the current Execution version and exact observed proposal/source version. A second submitted revision during review makes that response stale. Seeing an edit after accepting an earlier approval preserves history; changing approved scope requires new approval.

Retaining keeps the original manifest and already accepted approval for that exact scope. Only an invalidated **unresolved** wait receives a new request identity and fresh response; an approved gate is not recreated. Retain cannot clear event gaps, workspace uncertainty or external effects. Human invocation accounting remains governed by ADR 0003; the fixture checks request identity/state but does not implement its complete accounting/saga.

Adoption requires the exact current proposal, a quiescent predecessor, independently settled writer/effect/checkpoint obligations and new bounded admission. It creates a linked successor at entry with verified explicit inputs and inherited delivery mapping; no approvals or completed nodes transfer. An adopted predecessor is terminal: late events or responses remain auditable and cannot reopen it or replace its successor. Transfer/reconcile relevant subscriptions to the current lineage run explicitly; publication does not infer routing from an old run ID.

## Consequences and evidence limits

The protocol separates live collaboration from authority over execution. PostgreSQL remains the owner-local acceptance substrate, and CRDT data remains an adapter representation. Immutable content can be read/exported without a live collaboration session or the public registry.

The experiment supplies actual two/five-replica Yjs convergence, loopback transport, durable source/Execution state, lost acknowledgments, killed workers and a database restart. It includes a 50-KiB document, 100 flat nodes, two reduced run records and a 60-second disconnect with artificial transport delay. It does not prove the five-browser/two-native-run release journey, production push/presence latency, real network performance, integrated Human Interaction, multi-tenant authorization, HA, compaction/retention, complete graph semantics or a production editor. See the report for measurements and initial defects corrected by independent review.

Keep the full release qualification, concrete wire schemas, richer graph representation, production transport/authentication, snapshot retention/compaction and integrated lineage subscription routing as explicit remaining work. This decision does not reopen #5 licensing or select Agents Assemble's hosting topology.
