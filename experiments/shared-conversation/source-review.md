# Shared conversation independent source review

2026-09-12 · Wayfinder #13 · Read-only research; no native model sessions, Git mutations, or GitHub mutations.

## Version and source boundary

This review examines existing generated protocol files under `/tmp/agents-assemble-codex-schema.2sGzYa/v2/`, produced earlier for installed Codex 0.153.4 according to the repository's harness report. Parent should bind its own freshly generated schema hash and binary version to native observations; this review does not independently certify that earlier generation provenance. Official OpenAI documentation was searched and fetched from [App Server](https://learn.chatgpt.com/docs/app-server); the Markdown snapshot is `/tmp/agents-conversation-app-server-official.md`.

The official page documents `turn/steer` as appending input to the active turn, requiring matching `expectedTurnId`, failing when no turn is active, and emitting no new start notification. `thread/read` does not subscribe or load; `thread/resume` joins the event lifecycle. `item/completed` supplies authoritative final item state. WebSocket ingress overload has a documented rejection (`-32001`); the page does not establish replayable native event offsets or durable input idempotency. Pagination is experimental and paginated thread creation/full reads/resume currently fail closed. App Server/WebSocket production support remains experimental. These facts describe the interface, not distributed-delivery certification. [Official App Server documentation](https://learn.chatgpt.com/docs/app-server).

## Installed-schema findings

- `TurnSteerParams.ts`: mandatory `threadId`, `expectedTurnId`, `input`; optional `clientUserMessageId`. `TurnSteerResponse.ts` returns only `turnId`. It cannot prove the instruction was obeyed or completed.
- `TurnStartParams.ts`: optional `clientUserMessageId`; its `turnTrigger` comment explicitly describes this request steering an already-active turn. **Do not use `turn/start` as a conditional idle-to-new-turn primitive.** There is no expected-idle/predecessor parameter in this schema. A stale idle observation can race another start and append input to the wrong active work.
- `ThreadItem.ts`: `userMessage` has native `id` plus nullable `clientId`; this suggests a useful correlation path but does not document deduplication or uniqueness. Identical content cannot identify one delivery; duplicated client IDs must remain ambiguous unless the pinned probe proves stronger behavior.
- `TurnInterruptParams.ts`: carries `threadId` and `turnId`, but has no explanatory precondition guarantee. Native tests must try an old turn ID while a later turn is active; field presence alone does not establish exact-target rejection.
- `AgentMessageDeltaNotification.ts`: thread/turn/item IDs and text delta, no durable event sequence or offset. Item IDs cannot deduplicate repeated deltas within one item. Content hashing would incorrectly erase legitimately repeated text.
- `ThreadReadParams.ts`: `includeTurns` loads rollout history, with full-history hydration deprecated for paginated threads. `Turn.ts` has `itemsView`; an empty `items` list may be an unloaded/summary representation. It is not proof that no user instruction was accepted.
- `ThreadResumeParams.ts`: prefer `threadId` only. For nonrunning threads a supplied history/path can override the requested ID; for running threads path is a consistency check. No output replay cursor appears in resume params. Resume can also change native configuration; recovery should not accept arbitrary caller overrides.
- `ThreadResumeResponse.ts`: backward cursors and optional initial turns page describe history hydration, not a durable chronological replay stream. `ThreadTurnsListParams.ts` defaults newest-first with summary items; item listing defaults oldest-first. Preserve direction and completeness metadata.

## Recommended contract consequences (design judgments)

1. One durable per-attempt dispatcher sequences all collaborators and control operations. Bind every input to immutable organization/run/occurrence/assignment-generation/attempt/native-thread identity, optional exact active turn, sender principal, authorization epoch, stable input ID and payload digest. Attribution belongs to the service ledger; native text or client metadata is not authenticated human identity.
2. Give input acceptance and native delivery separate records. Persist dispatch intent before writing the native request; preserve native response/correlation evidence before reporting delivered. A crash between these points is unknown, never queued-for-blind-retry. Exact replay of the service input ID returns the original outcome; changed bytes conflict.
3. Block further ordered instruction dispatch behind an unresolved predecessor unless an explicit policy settles or skips that order position. Otherwise a later visible input can overtake an earlier possibly accepted one. Human resubmission after uncertainty needs a new explicit identity and visible duplicate-risk acknowledgement, not implicit replay.
4. A queued steer retains its original turn target. Completion-before-dispatch causes rejection/needs-rebinding; never silently turn it into `turn/start` or target a successor. New work in a successor generation requires fresh bounded admission. Expired/revoked authority prevents new dispatch even if the input was accepted into the service earlier.
5. Treat redirect as a serialized explicit operation with separately visible outcomes for interrupt request, interrupt acknowledgment, observed native turn terminal state and target input delivery. Unknown interrupt outcome cannot authorize a replacement. ADR 0005 already proves native terminal interruption is insufficient writer-stop evidence.
6. Persist a bounded service output log with its own cursor and immutable source binding. Project deltas provisionally; replace with completed snapshots rather than appending snapshots again. On native disconnection record a capture gap; history recovery may fill known items but must not erase the gap or invent missing delta order. Retention expiry should return an explicit minimum available cursor/snapshot, and overflow an explicit gap or controlled pause. Continued observation must be independent of slow browser subscribers.
7. Conversation text can ask for work but cannot create approved revision identities, broaden tool permission, or grant publication/deployment approval. Pending native permission requests use the existing dedicated request/authority protocol. Permission revocation cannot retract an already accepted instruction; display that race honestly.

## High-value fault scenarios

1. Two senders race, including identical content with distinct IDs and the same ID with different content; prove durable ordering and immutable attribution.
2. Native duplicate `clientUserMessageId`, both same-content and changed-content; inspect live user items and persisted readback separately. Do not infer a guarantee from one no-duplicate observation.
3. `turn/start` while an active turn exists; idle-read/start race; steer after completion; old steer ID while a new turn runs.
4. **Old `turn/interrupt.turnId` while a new turn runs**, plus wrong thread, missing turn and idle thread. Detect whether native interrupt actually honors the ID.
5. Daemon death before send, after socket write, after native acceptance before response retention, and after retention before service acknowledgment. Preserve unknown delivery and no replay where appropriate.
6. User-item correlation absent, client ID null, duplicate IDs, history unavailable, summary-only items, truncated history, and native acceptance preceding persisted user-item visibility. None is negative acceptance proof.
7. Permission revoked between service enqueue and dispatcher admission; generation replaced while queued; old acknowledgment arriving after a successor exists. Only the historical input may change status.
8. Input N unknown while N+1 waits; concurrent redirect and input; two simultaneous redirects. No silent reorder or transfer to new targets.
9. Output interleaved across threads/turns/items; repeated identical delta text; duplicate completed snapshot; snapshot racing live deltas; slow subscriber and retention overflow. Scope keys prevent corruption, and gaps remain visible.
10. Successful interrupt and native `interrupted` while inherited writer remains alive: assert conversation UI cannot mark execution safely stopped or admit recovery.

## Remaining questions for empirical evidence

How soon and reliably does client ID reach user-message snapshots, and does it survive restart? Is `turnId` actually enforced by interrupt? Is accepted steer ever discarded on immediate interruption, or deferred across the next native turn? Is item history sufficiently complete for positive delivery reconciliation? These require native observation; this research provides no favorable assumption.
