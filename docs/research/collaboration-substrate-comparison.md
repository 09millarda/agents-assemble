# Collaboration substrate comparison for decision #12

Checked 2026-09-12 against current primary documentation. This is supporting research, not conformance evidence or a resolved decision.

## Existing constraints

Local sources read: `docs/architecture/0002-playbook-and-action-contract.md`, `docs/architecture/0003-durable-execution-and-recovery.md`, `docs/first-release-contract.md`.

The release requires concurrent Markdown and graph drafts, presence, attributed edits and reconnect recovery. Acknowledged changes cannot disappear. Explicit submission alone proposes an immutable execution-relevant revision; draft autosave does not alter a pinned run. Knowledge submission, Execution observation, acknowledged pause and adoption are separate states. ADR 0003 requires context-local acceptance/inbox/outbox transactions, scoped command identity with payload conflict detection, source-stream ordering and explicit gap recovery. Neither collaboration library replaces this protocol.

## Profile A: Yjs updates, durable server ingestion, explicit revision submission

Yjs updates are commutative, associative and idempotent; replicas receiving all updates converge despite duplication or reordering. Updates can be persisted and replayed, or compacted using `mergeUpdates`. Binary merging alone does not garbage-collect deleted content. These properties suit disconnected browser edits and reconnect. They establish convergence of supported shared values, not graph validity or agreement about intent. [Yjs update API](https://docs.yjs.dev/api/document-updates).

Use `Y.Text` for Markdown text rather than replacing an entire string property per keystroke; its indices are UTF-16 code units. Use stable IDs and field-granular shared maps for graph entities. `Y.Map` values may contain nested shared types; plain JSON object replacement does not provide field-level collaborative merging. [Y.Text](https://docs.yjs.dev/api/shared-types/y.text), [Y.Map](https://docs.yjs.dev/api/shared-types/y.map).

**Snapshot and attribution trap:** Yjs insertion clocks do not advance for deletions. Its state vector therefore cannot identify an exact visible revision. A Yjs snapshot includes both a state vector and delete set. Native Yjs deletion records do not retain deleter or deletion time; garbage collection can discard deleted content. Maps choose one competing value per key; this is deterministic conflict resolution, not a semantic reconciliation dialog. [Yjs internals](https://github.com/yjs/yjs/blob/main/INTERNALS.md).

**Design implication:** freeze an exact server-accepted cut, store immutable materialized Markdown/normalized playbook JSON and digest, and retain sufficient CRDT checkpoint/log data for draft recovery. Do not identify approved revisions by state vector alone, use vector equality as an all-edits-durable check, or expect future garbage-collected draft state to reproduce an old approved revision. A deletion-only probe is essential.

`y-websocket` supplies central update distribution and an authentication/authorization integration point. Its documented `sync` event means content was received from the server; it does not specify a database-commit receipt. Its debounced HTTP callback is not an acknowledgment boundary. [y-websocket](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket).

**Required application layer:** assign each submitted update envelope an authenticated tenant/draft/session principal, stable command ID and payload hash; accept under current authorization and resource bounds, persist bytes plus audit/receipt and any local outbox atomically, then acknowledge. Retry exact envelopes after lost acknowledgment and return the stored outcome. Maintain a server draft epoch and accepted sequence for replay/cut identity. Rejecting untrusted bytes must precede canonical application/broadcast; inspect using an isolated document. A rejected locally applied update needs explicit rejected status and clean resync/proposal export, not endless replay of contaminated state.

Presence is ephemeral schemaless client state, separate from the Yjs document. It cannot be the audit or permission authority. [Awareness API](https://docs.yjs.dev/api/about-awareness), [awareness persistence](https://docs.yjs.dev/getting-started/adding-awareness).

**Attribution implication:** record the authenticated principal accepting responsibility for an ingress envelope and its accepted change/diff. Client IDs, transaction origin and user-supplied awareness names are not authenticated authorship. A full-state reconnect payload can include other actors' work: do not relabel all enclosed structures as its sender's edits. Preserve original authenticated envelopes/receipts, distinguish imported/unknown provenance, and avoid promising forensic per-character or native deletion authorship.

## Profile B: centralized versioned operations using ShareDB

ShareDB applies an operation optimistically locally, then acknowledges server commitment via `submitOp` callback; the local document version advances for that operation after acknowledgment. A composed operation may encompass multiple local edits. A client-visible version is therefore useful only when related pending operations are resolved. [ShareDB Doc API](https://share.github.io/sharedb/api/doc).

Server middleware offers authorization before application, validation of the updated snapshot before commitment, and an `afterWrite` hook once op and snapshot are stored. Apply hooks can repeat when competing operations win the commit race, so they cannot contain assumed-once side effects. Authenticated user metadata can be attached server-side. [ShareDB op lifecycle](https://share.github.io/sharedb/middleware/op-submission).

The database adapter owns persistence; the default memory adapter loses data on restart. A PostgreSQL adapter is listed, but documentation alone does not prove the required transaction coupling, failover or crash guarantees. [ShareDB database adapters](https://share.github.io/sharedb/adapters/database).

ShareDB retains operations by default and reconstructs historical snapshots by version, optionally accelerated by milestone snapshots; historical snapshots are read-only and native branching is not supported. This makes an exact submission cut more direct than a CRDT state vector, but immutable product revisions, digest identity, submission idempotency and Execution outbox still belong to the application. [ShareDB document history](https://share.github.io/sharedb/document-history).

The default JSON0 type supports object/list operations and embedded text, but lacks object move and has quadratic transformation cost in large competing operations. Reordering by delete-and-insert can lose concurrent edits; its list-move operation exists to avoid that issue. Stable node IDs plus explicit ordering/reference fields still need deliberate modelling. [JSON0 primary README](https://github.com/ottypes/json0). Presence exists; documented version-aware typed presence currently depends on the rich-text type, so plain Markdown and graph cursor behavior needs its own validation. [ShareDB presence](https://share.github.io/sharedb/presence).

## Selection implications and common rules

Recommend Profile A as the bounded candidate if offline/reconnect flexibility and existing editor bindings dominate; its server durability and attribution envelope are mandatory custom work. Profile B is a credible alternative when central operation validation and simple integer snapshot cuts dominate; it trades that simplicity for OT-type/editor integration and adapter verification. Do not claim either is selected or production-qualified from these docs alone.

Neither guarantees semantic graph correctness. Concurrent node deletion plus incoming edge creation, duplicate sibling IDs, incompatible references, cycles or concurrent parent moves can converge into invalid definitions. Permit representable invalid drafts with visible diagnostics; reject execution-relevant submission until the normalized document meets ADR 0002. Never silently delete dangling references or choose executable behavior based only on a CRDT/OT winner.

For either profile, create a server-issued reviewable snapshot candidate bound to draft/epoch/cut, normalized bytes, digest and validation result. An explicit submit command references that candidate plus expected submission-head generation. Commit its stable verdict, immutable revision/proposal, sequence and outbox in Knowledge's transaction. A duplicate command returns the same verdict; a changed payload under that identity conflicts. Two distinct competing submissions use compare-and-swap: one advances the head, the other returns a visible conflict for review/retry. Later edits remain live draft work and cannot change the candidate. A submission receipt proves Knowledge acceptance only; Execution separately observes, pauses and retains/adopts under ADR 0003.

Minimum evidence needed: deletion-only cut; duplicate/reordered updates or ops; disconnect/reconnect; process crash before/after persistence and lost acknowledgment; exact submitted bytes despite concurrent editing; competing submissions; unauthorized/revoked ingress; graph invalidity; authenticated provenance surviving reconnect; immutable revision reproduction; ordered/gapped Execution observation. The release workload/latency targets require later measured qualification, not claims from a small local probe.
