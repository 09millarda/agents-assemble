# ADR 0004: durable runner receipts and verified checkpoint reconstruction

Date: 2026-09-12
Status: **Accepted — minimum receipt/recovery protocol with bounded fixture and native evidence; automatic takeover remains gated on unresolved writer scope.**
Decision: [#8](https://github.com/09millarda/agents-assemble/issues/8) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Decision

Keep Execution as the authority for invocation admission, assignment generation and result acceptance. Require the customer daemon to maintain a durable local journal of accepted commands, invocation launch uncertainty, checkpoints, results and stop observations. A reconnect reconciles these records; it does not authorize another invocation.

Use verified Git and immutable artifact context to reconstruct work in a fresh native harness session when exact native continuation is unavailable. A reconstructed invocation needs a new attempt, a declared recovery class and a fresh bounded grant. Preserve the original failing baseline separately from the recovered working checkpoint.

This selects a minimum protocol and conservative recovery behavior. It does not select a production local journal database, tunnel/signing protocol, daemon package, launch OS, first-release harness or process isolation technology. The disposable fixture's persistence and transport choices are experiment inputs.

## Three independent acceptance boundaries

| Boundary | Durable fact | What remains outstanding |
| --- | --- | --- |
| Execution admits an invocation | Current assignment, generation, finite grant, pinned scope and charged budget commit in Execution's PostgreSQL transaction. | Delivery, daemon acceptance, launch and completion. |
| Daemon accepts the command | A local inbox and unique invocation entry retain the immutable command before the receipt acknowledgment. | Native start, completion and authoritative service acceptance. |
| Execution accepts a result | Execution independently validates and commits the result verdict with its inbox/state/outbox. | Any separately owned artifact, publication or recovery obligations not covered by that verdict. |

The service and daemon never share a transaction. Neither an open tunnel nor a local success message replaces one of these commits. ADR 0003 remains the production service persistence contract. The #8 service fixture isolates daemon behavior and does not certify the complete PostgreSQL/tunnel/harness composition.

## Command identity and local journal

Bind commands to the deployment/organization, enrolled runner and durable journal incarnation, run/occurrence, attempt/invocation, assignment ID/generation, operation and command ID. Pin the payload digest, definition/input scope, grant expiry, recovery class, runtime/environment references and admission identity. Authenticate the sender separately; identifiers and matching hashes do not establish trust.

Persist the command receipt before acknowledging it. Exact duplicate delivery returns the prior verdict; changed content under the same identity conflicts. Enforce invocation uniqueness independently of command deduplication: changing a command ID must not permit a second launch of the same admitted attempt. Reject incompatible scope and expired grants at receipt and revalidate before starting work.

Before calling the native harness, commit a launch intent. A local transaction cannot atomically commit the harness's creation of a session or start of a turn. If the daemon dies after intent and before a durably correlated outcome, classify the invocation as uncertain. Do not replay a native start request on the assumption that no response means no work. Use exact adapter-supported lookup/reattachment only when the invocation's identity and state can be established; otherwise pause for reconciliation and fresh admission.

Persist result identity, payload digest, checkpoint references and local outcome before transmission. Retry the same result after a lost acknowledgment. A previously committed Execution verdict remains queryable/idempotent; a previously unaccepted expired or stale result cannot advance the replacement assignment. Late observations may support a separate recovery decision while retaining their original authority and provenance.

## Reconnect, expiry and lost journals

Reconnect reauthenticates the runner and presents its journal incarnation, outstanding command receipts, invocation stages and result/checkpoint identities. Execution returns its current authority and recorded verdicts. Redelivery of an accepted command never creates another invocation or consumes a new budget allowance.

A missing, corrupt or rolled-back journal after previously accepted work is an uncertainty condition. Do not recreate an empty journal with the old identity and declare old work unreceived. A replacement installation needs a new incarnation and explicit accounting for the previous writer before admission. Define retirement/retention so deduplication records survive the supported replay horizon; expiry alone is not a safe tombstone deletion rule.

During disconnection, no new work is admitted. Any allowed local continuation must be explicitly bounded by the accepted grant and offline policy. A conservative local monotonic deadline helps the daemon stop; clock skew, suspension or restart must lead to revalidation rather than assumed authority. Execution always checks its own authoritative expiry. The fixture's controlled clock values do not validate production deadline conversion.

## Cancellation and stop observations

Cancellation stops future admission and creates accounting obligations for work already accepted. Address stop requests to the exact assignment, attempt, generation and local invocation/supervisor identity. Keep request delivery, native interruption, local exit, durable result and effect reconciliation distinct. A stopped acknowledgment for an old generation cannot mark a replacement writer stopped.

Require evidence for the scope actually stopped. A native turn interrupt or parent process exit does not prove all tool descendants terminated. When the daemon cannot establish process ownership, it must retain an unresolved writer obligation. Production supervision/containment remains an explicit adapter acceptance requirement.

A server fence cannot revoke direct Git, cloud or other credentials already available on a customer machine. Nor can a local stop receipt prove that a remote request never took effect. Preserve external-effect uncertainty independently of local-writer state. Prefer service-mediated publication through scoped intents and authoritative reconciliation; actual integration transport and receipt provenance remain unproved by the provider fixture.

## Checkpoint verification and fresh recovery

The manifest pins registered repository/upstream identity, original failing baseline commit, recovered commit/tree, checkpoint publication/ref retention, exact artifact bytes and hashes, accepted input/context scope, source assignment/generation, runtime/environment references and outstanding effects. It contains secret references rather than values, and no native account tokens.

Publish required Git objects and artifacts before making recovery available. Verify them through a separate destination retrieval path: exact commit/tree identities, required baseline ancestry, configured upstream binding and artifact content hashes. A moving branch name, unpushed local commit or `verified: true` assertion is insufficient. Pin the verified content used for reconstruction. If publication succeeded but its receipt was lost, reconcile the same immutable content before advertising availability.

Keep the failing baseline for reproduction/history and the recovered commit for the next worktree. Checkpoint verification alone is not permission to run: Execution must admit a new bounded attempt under a declared recovery class after required writer/effect obligations are accounted for. Re-resolve authorized environment bindings; old secret versions are not resurrected to reproduce history.

The native reference probe uses plain Git text files and selected immutable context. Submodules, Git LFS, required untracked files, services, toolchains, unavailable artifacts and cross-OS differences need their own declared eligibility checks. Fresh-session reconstruction on a separate clone on the same host does not certify another machine or live transcript migration.

## Evidence and remaining frontier

The [runner recovery report](../research/runner-recovery-conformance.md) records 26 passing durable daemon/loopback scenarios, an independent 25-assertion daemon review, an actual native repair/fresh-session recovery and a separate 25-assertion archive/integrity audit. The actual native SIGKILL probe left tool descendants alive and explicitly paused recovery. These remain distinct evidence paths; no end-to-end production certification is implied.

First-release scope (#4), license/parity (#5), authenticated tunnel/receipt provenance, live integration publication, enrollment, secrets, packaging and broader harness/OS compatibility remain open. The observed surviving native tool makes [#9, supervision and scoped stopped-writer evidence](https://github.com/09millarda/agents-assemble/issues/9), the next sharp technical decision. Until that evidence exists, the accepted behavior at an uncertain native boundary is a recovery pause.
