# ADR 0009: ordered conversation delivery and exact native-turn control

Date: 2026-09-12
Status: **Accepted — bounded Codex adapter contract with separate native and durable-fixture evidence. Integrated production delivery remains unproved.**
Decision: [#13](https://github.com/09millarda/agents-assemble/issues/13) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Decision

Provide a shared, attributed conversation through an Execution-owned input ledger and a single dispatcher for each admitted native attempt. Use Codex App Server `turn/steer` with the exact active turn precondition. Deduplicate in Agents Assemble before the native boundary. A committed dispatch intent without a durably correlated native outcome becomes **unknown** and is never automatically sent again.

Treat interruption and redirection as explicit operations with independent delivery, native-terminal, writer and external-effect states. Conversation text cannot approve a revision, publication or deployment, expand an invocation grant, or admit replacement work. These rules apply equally to hosted and self-hosted operation; no terminal or replacement harness is introduced.

## Evidence that determines the boundary

The actual installed Codex 0.153.4 accepted the same `clientUserMessageId` three times and retained three distinct user items: two identical messages and one changed message. It also accepted `turn/start` during an active turn as input to that same turn. Therefore neither field presence nor JSON-RPC request identity supplies application idempotency, and `turn/start` is not an atomic “start only if idle” operation.

Wrong/old turn IDs were rejected for steering and interruption, including while a subsequent turn was active. Exact interruption acknowledged successfully and the native turn became interrupted. This is evidence for that pinned version, not a general stop guarantee. Existing ADRs 0004–0006 continue to govern writer evidence, authority and recovery.

Persistent user-item IDs/content survived App Server restart in the probe. An immediate post-interrupt read omitted a command item later present after restart. Ephemeral threads rejected history reads with `includeTurns`. History can support positive reconciliation, but missing items never prove nondelivery. See the [experiment report](../research/shared-conversation-conformance.md), including the separate limitations of each evidence path.

## Ownership and identities

Execution owns conversation commands that can affect admitted work, their sequence, native-target mapping and accepted delivery verdicts. Fleet owns the authenticated runner transport and local journal observations; it does not become the authority for continuation. A replaceable read projection supplies the shared output UI. Human Interaction retains structured questions and approval responses. Knowledge/Catalog revision submission remains separate under ADRs 0007–0008.

Bind each input to deployment, organization, run, occurrence, assignment/generation, attempt/invocation, enrolled runner/journal incarnation, native session/thread and exact native turn. Include a stable input ID, operation kind, immutable UTF-8 content/digest, authenticated sender, authorization/grant references and service-assigned sequence. Do not accept caller-supplied display names as identity. The native user message may contain an attributed presentation envelope, but the service ledger is authoritative about who submitted it; native `clientId` is only a correlation hint.

A service transaction allocates sequence and immutable identity with the outbox command. Retries by an authorized reader return the existing status; changed payload, sender or target under that identity conflicts. Two different input IDs with identical text are distinct instructions. Recheck current authorization when reading status/output and before bounded dispatch admission. Preserve historical attribution after revocation without exposing history to a revoked reader.

## Delivery protocol

| Visible state | Established fact | Permitted next step |
| --- | --- | --- |
| Queued | Service durably accepted exact input and ordering position. | Deliver same envelope to its bound daemon. |
| Received | Daemon durably journaled it. | Revalidate target, grant, scope, order and dispatch authority. |
| Sending | Exclusive dispatcher committed native dispatch intent. | The holder of that newly acquired dispatch claim may perform one native call. |
| Delivered to Codex | Correlated native success was durably retained and accepted by Execution. | Observe execution; do not describe the instruction as completed or obeyed. |
| Rejected | A definitive rejection or pre-send policy decision is recorded. | Explain reason; any rebinding is a new explicit command. |
| Delivery unknown | Native call may have happened but no durable verdict establishes its outcome. | Reconcile or pause; do not turn it back into queued. |

“Sending” is a persisted uncertainty marker, not a reusable permission to call the harness. A retry must distinguish acquiring a fresh dispatch claim from finding an existing in-flight record. Only one holder can dispatch; a restart cannot recover that transient claim and reuse it. Duplicate transport delivery replays the local record. Lost service acknowledgment replays the same durable daemon receipt. A delayed receipt updates only its original historical input and cannot advance a successor; accepted/rejected verdicts cannot regress under stale snapshots.

Native errors are definitive only when the pinned method/error mapping establishes rejection before acceptance. Timeout, EOF, ambiguous internal failures and loss between acceptance and receipt persistence remain unknown. Positive history reconciliation must match the original trusted journal/session/turn, unique client correlation and exact payload; ambiguous or repeated matches remain unknown. Never use text matching alone or resend to discover whether the first call happened. Unsupported lookup falls back to a visible pause.

Ordinary inputs dispatch in service order. Missing or uncertain earlier inputs block later instructions. Completion before a queued steer reaches the harness rejects that target; never silently convert it to `turn/start`, select a newer active turn, or follow a successor. A deliberate reissue gets a new ID and explicit linkage to the prior input and requires current authorization/admission; the interface must explain any unresolved possible prior delivery.

The dispatcher is the sole authorized controller of its attempt's native session. Use a dedicated session and fail closed if ownership/target continuity cannot be established. Do not use a stale idle read followed by `turn/start` to establish exclusivity. New invocation starts retain ADR 0004's launch-intent uncertainty and bounded admission. Native client ID support does not weaken those rules.

## Interrupt and redirect

1. Accept an exact-target interrupt through a reserved bounded control path, even when the ordinary input queue is full or blocked on uncertainty. Duplicate control identity returns its prior verdict. Do not send a second interrupt merely because the first response was lost.
2. Closing the continuation gate is part of accepting the interrupt operation. Stop dispatching ordinary queued instructions while it is pending, unknown or acknowledged. Preserve their original targets/statuses for review; an explicitly definitive failed interrupt can release the gate after target/authority revalidation. A missing earlier stop command in a daemon inbox must still block later steering.
3. Report native acknowledgment separately from the observed interrupted/completed turn. A terminal race may make the native request reject; reconcile the exact original turn rather than interrupting current work. Missing terminal evidence remains unresolved.
4. An interrupt acknowledgment or terminal turn does not establish all writers stopped, cancel downstream effects or authorize a new invocation. Preserve independent stopped-writer and effect obligations from ADRs 0004–0006 and the unresolved protected-observer work in #11.
5. Redirection records the requested replacement input and its relationship to the interrupted attempt. The conservative reference starts a fresh native session under a newly admitted bounded attempt once required gates are satisfied. Rebind only explicitly selected instructions; do not copy pending input automatically. This avoids assuming that accepted but unobserved steering was discarded from native context. Same-session continuation across interruption remains a capability requiring further evidence.

Steering within an already admitted turn can redirect attention within its current scope. It does not change the pinned specification, tool authority or approved effect manifest. Document revisions, native permission requests and deployment/publication approvals use their dedicated authenticated, revision-bound protocols. A message containing “approved” has no approval semantics.

## Authorization cutoff

At enqueue and dispatch, validate sender, exact target, scope and finite grant. The service-to-daemon/native gap is not a distributed transaction. ADR 0006's explicit effective revocation cutoff and bounded authorization apply; an instruction admitted before that cutoff may already have reached Codex. Revocation cannot retract model context or already-started external effects. Display that fact and use interruption/reconciliation as appropriate. A stale membership projection or a preexisting input receipt cannot authorize unlimited new sends.

The experiment uses synchronous controlled authority at dispatch and does not implement distributed authorization, malicious-daemon protection or protected observer continuity. The selected contract requires those production boundaries; the fixture does not prove them.

## Output capture, replay and backpressure

Capture only the interface's available user/assistant output and permitted tool activity. Do not promise hidden reasoning, complete native transcript access or disclosure of local secrets. Apply access policy and output filtering before durable sharing, while preserving explicit omission markers. Native tool content remains untrusted and cannot issue domain commands.

The daemon assigns its own monotonic capture sequence within a journal/stream incarnation before service delivery. Each event binds organization/run/attempt/generation and native thread/turn/item where available, event kind, payload digest and capture provenance. Execution's projection accepts exact retries by that identity, rejects changed bytes and enforces ordered capture cursors. Do not deduplicate deltas by item ID or text hash: repeated identical text may be legitimate. Transport duplicates use the daemon event identity, not an invented native offset.

Treat deltas as provisional item projections. A completed item snapshot replaces that item's accumulated content; it is not appended again. Preserve native turn completion independently from item capture completeness. Readback/resume after a gap supplies labeled history snapshots, not a fabricated replay of missing delta order. Keep a capture-gap marker even if selected final items are recovered. An absent, compacted, ephemeral, partial or summary history is not evidence of no input or tool execution.

Slow browsers consume the service log independently of native ingestion. Configure byte/event quotas, reserved control capacity and retention/replay horizons. A retained snapshot has an exact through-cursor and source scope; requests older than the retained lower bound receive snapshot-required/expired status. Never silently restart at the latest cursor. If the native capture queue cannot retain further output, emit a gap/overflow marker and apply the declared controlled-pause policy; do not block the interrupt path or manufacture complete history. Preserve deduplication tombstones/high-water marks for the supported retry horizon.

The reduced fixture proves numeric cursor order, duplicate/conflict/gap behavior and three-record retention with an explicit snapshot-required response. It does not implement byte limits, snapshot materialization, a production event relay, authenticated native-event ingress or browser streaming.

## Scope and next work

The [evidence](../research/shared-conversation-conformance.md) is sufficient to select these conservative semantics. It does not certify release performance, the full shared UI, real multi-user authentication, production PostgreSQL/daemon/native composition, crash-time native reattachment, output redaction, complete transcript retention, other versions/harnesses or automatic takeover.

Keep remaining implementation and qualification details in the canonical map's unspecified work. No new decision ticket is needed merely to repeat those limitations. #11, #14 and #15 remain independent architectural questions; this session resolves only #13.
