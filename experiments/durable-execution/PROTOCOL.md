# Disposable durable-execution experiment protocol

This is throwaway feasibility code. It exercises transaction boundaries in real PostgreSQL processes; it is not the product workflow grammar, a production dispatcher, or an authentication implementation.

Run `node worker.mjs '<command JSON>'` with `PGHOST`, `PGPORT`, and `PGDATABASE`. A command is `{context,id,op,run,...arguments,crash?}`. Context is `execution`, `human`, `knowledge`, `integrations`, or `provider`; each process connects as only `aa_<context>` with the disposable password `throwaway`. The bootstrap grants only that role's schema. The worker never reads another context's tables.

All contexts own identical `records(id,state)`, `inbox(id,payload,outcome)`, and `outbox(id,recipient,payload,delivered)` tables. Domain state is JSONB. Normal record IDs are the run ID; Human uses explicit `requestId` when provided; provider has `delivery:<deliveryId>` and `effect:<effectId>` IDs. `snapshot {run}` is a read-only diagnostic returning `{ok:true,state}` without creating an inbox row. The harness may inspect all schemas as its test administrator.

## Transaction and transport contract

Every mutating command performs one transaction: insert/deduplicate inbox, lock the inbox row, lock its run record, modify local state, append local outbox, and store the accepted or rejected outcome. Domain rejection rolls back to a savepoint and retains the rejected inbox outcome. Repeating an ID with equal PostgreSQL JSONB payload returns the stored outcome before revalidating mutable state or deadlines, except the one-shot dispatch hint described below. Reusing an ID with a different payload returns `idempotency_payload_conflict`. `crash` is excluded from identity. JSONB object key order does not affect identity.

`crash:'beforeCommit'` sends SIGKILL after preparing local state/outbox/outcome but before COMMIT. `crash:'afterCommit'` sends SIGKILL after COMMIT and before printing the outcome. A normal process prints one JSON line `{ok:true,...}` or `{ok:false,error}`. Process failure has no durable effect until COMMIT. The harness must distinguish a missing response from a rejected command.

Outbox IDs are `<source context>:<command id>:0`. Each outbox payload includes `op` and `run`. A trusted relay copies a committed row as `{context: row.recipient, id: row.id, ...row.payload}` and marks delivery afterward. Repeating delivery is safe. The sender's outbox is immutable; delivery never reconstructs approval from an arbitrary client object.

The `transportVerified:true` field is an explicit trusted-harness assertion, not cryptographic authentication. `integrations.reserve` validates the scope and effect digest, but cannot cross-read Execution. The experiment therefore does not prove service authentication, unforgeable transport, or receipt provenance. A production adapter must authenticate that a payload is exactly the committed outbox message.

## Execution commands

| Operation | Arguments and behavior |
| --- | --- |
| `admit` | `limit,maxAttempts,manifest,spec,deliveryId`, optional `recoveryClass` (default `verified-checkpoint`). Creates an active run at version 0, zero work/attempts, no approvals/completions. Budgets are nonnegative safe integers. No implicit predecessor admission. |
| `freezeMembership` | `members`: ordered unique strings, maximum 100. Freezes once; duplicates or a second freeze reject. |
| `openWait` | `manifest,deadline` (Unix epoch milliseconds). Manifest must exactly equal admission manifest; deadline must be future. Requires no active writer. Debits one work unit for the Human invocation and stores exact approval scope and wait version. Assigns request identity `<run>:wait:<version>` and returns `version,expectedVersion,requestId,scope`. Unresolved waits block work/publication. |
| `reissueWait` | `expectedVersion,deadline`, optional exact `manifest`. Requires an unresolved wait invalidated by a later Execution version, cleared independent recovery flags, and no writer. Charges a fresh Human invocation; preserves the old request as superseded in `waitHistory` and creates a new request identity/version. Returns `version,expectedVersion,requestId,scope`. |
| `humanResponse` | `requestId,manifest,expectedVersion,decision:'approve'|'deny',responseId`. Requires exact current request identity and wait manifest, both current Execution version and wait version, and current time strictly before the deadline. Approval stores the canonical scope. Denial blocks execution. |
| `expireWait` | No extra arguments. Due-only transition resolves the wait as expired and blocks execution, without granting approval. Cancellation status is preserved when cancellation is already pending. |
| `observeEdit` | `source,seq,revision`. Sequences are positive integers scoped to this run/source. A newer source revision blocks new work/publication. A gap adds an independent gap obligation. Equal latest sequence/revision is an accepted no-op; stale or conflicting data rejects. |
| `retain` | `source,seq,revision,expectedVersion`. Requires exact observed revision and current CAS version. Acknowledges that observation while retaining the admission-pinned spec. Clears only that source's observed-edit obligation, never workspace/effect/cancel/gap obligations. |
| `reconcileGap` | `source,seq,revision,authoritative:true`. Requires the exact latest known authoritative revision and an existing source gap. Clears only that source's gap flag; the observed revision still requires retain. |
| `acquire` | `expectedVersion,leaseMs`. Requires an active run, no independent blocking flags, no unresolved wait, no writer, no pending retry, and available work/attempt budgets. Atomically debits one of each and increments generation, returning `version,generation,leaseDeadline`. |
| `complete` | `generation`. Requires the currently owned generation and an unexpired lease. Records completion and clears the writer. A stale/expired completion rejects. |
| `stopWriter` | `generation` must match the current writer. Accounts for the current writer stopping and creates an independent workspace recovery obligation. |
| `reconstruct` | `verified:true,pinnedSpec,recoveryClass`. Exact pinned spec and declared recovery class verification clears only workspace recovery, with no new invocation debit. The subsequent acquire charges the single invocation. |
| `scheduleRetry` | `dueAt`. Persists a timer when work is otherwise eligible and no writer exists. |
| `fireRetry` | `expectedVersion,leaseMs`. Requires a persisted due timer; performs the same bounded admission/debit as acquire and clears the timer atomically. |
| `requestPublication` | Optional `grantExpiresAt` (default DB time + 60 seconds). Requires exact canonical Execution approval, no blockers/open wait/writer. Debits one work unit for the Integration invocation and persists a pending effect and Integration outbox intent. Returns `effectId,deliveryId,intent,outboxId`. |
| `publicationReceipt` | `effectId,receipt`. Requires matching effect and delivery IDs; confirms that effect and clears effect blocking only when all accepted effects have receipts. Conflicting receipts reject. |
| `cancel` | Sets an independent cancellation flag and pending status. Accepted publication intents remain obligations. |
| `settleCancellation` | Requires no writer and receipts for every accepted effect. Sets cancelled status; does not erase other recovery obligations. |
| `successor` | `newRun,admission:{limit,maxAttempts,manifest,spec}`. Atomically creates a newly admitted run and supersedes its predecessor. Requires predecessor quiescence, reconciled effects/edits/gaps/workspace, and settled cancellation if requested. Optional `adopt:{source,seq,revision}` atomically adopts the sole exact observed revision when it equals the new admission spec; other gaps/recovery must already be reconciled. Inherits only delivery identity; starts with zero work, attempts, approvals, completions, and unfrozen membership. |

The shared `work` bound charges every modeled Runner, Human, and Integration invocation. `maxAttempts` bounds Runner attempts in this reduced model; response delivery, receipt reconciliation, and verified workspace preparation do not invoke a worker and do not debit work. The full occurrence grammar is outside scope. Every successful Execution mutation increments `version`; the already-known observation no-op does not. Compare-and-swap versions protect response and retain acceptance and competing acquires. Canonical approval scope is exactly `{run,manifest,spec,members}`. It excludes transient workflow versions and observed-edit acknowledgement history: acquiring/completing work or retaining the pinned spec does not revoke an otherwise matching approval.

Execution state contains `status,version,work,attempts,members,membershipFrozen,knowledge,observed,sequences,gaps,approvals,flags,writer,generation,completions,retry,wait,effects` plus admission fields. `flags` has independent `edits,workspace,effect,cancel,gap` booleans. `wait` has `requestId,manifest,deadline,version,scope,resolved,status`; `waitHistory` retains previous requests, including superseded identities. `writer` is null or `{generation,leaseDeadline}`. `retry` is null or `{dueAt}`. Each `effects[effectId]` contains `status,intent,receipt?`.

## Human, Knowledge, Integration, and provider commands

| Context/operation | Arguments and behavior |
| --- | --- |
| Human `open` | `requestId,manifest,expectedVersion,deadline,authorizedActors`. Creates a local immutable request keyed by its request identity (legacy fallback is run ID). |
| Human `respond` | `requestId,actor,decision`, optional `expectedVersion` to check the local request. Requires authorized actor, current local request, no existing response, and unexpired deadline. Commits the response and Execution `humanResponse` outbox atomically. The outbox retains the exact request identity. Execution independently checks its current request identity and version; an old Human response remains in its own local request record even if Execution rejects it as superseded. |
| Knowledge `save` | `source,revision`. Commits the next source sequence/revision and Execution `observeEdit` outbox atomically. |
| Integration `reserve` | `intent,transportVerified:true`, as copied from Execution outbox. Verifies Execution authority, exact run/scope/effect digest, and unexpired grant. Stores the effect as pending. |
| Integration `beginEffect` | `effectId`. Checks the pending grant has not expired; durably changes pending to unknown before a provider call. Returns effect/delivery identity and `callPermitted:true`. A new begin command against an unknown effect rejects `effect_unknown_query_only`. |
| Integration `recordReceipt` | `effectId,receipt`. Requires a started effect and matching effect/delivery IDs. Commits confirmed receipt and Execution `publicationReceipt` outbox atomically. |
| Provider `createOrUpdate` | `effectId,deliveryId`. Acts as a separate remote system in this experiment. Effect idempotency returns the same receipt. A new effect for an existing delivery updates the same external identity. |
| Provider `query` | `effectId`. Returns `{status:'confirmed',receipt}` or `{status:'not_found'}`. Missing evidence never means an unknown effect is safely failed. |

A receipt is `{effectId,deliveryId,externalId,version}`. Provider delivery state records `updates`; provider effect state stores the immutable receipt. Concurrent effects for one delivery serialize on the delivery row.

## External attempt and cancellation boundary

Publication acceptance is the committed Execution decision plus outbox. Its intent includes exact scope, effect/delivery IDs, `executionVersion`, and finite `grantExpiresAt`. Later cancellation does not revoke this already accepted intent. The finite grant controls starting an attempt: reserve and begin reject an expired grant. Once begin has committed unknown, expiry or cancellation cannot convert unknown into failed or permit a blind resend.

The first uninterrupted begin response permits the harness to make the external attempt. If the process/response/provider path becomes uncertain, the harness queries by effect ID and records an authoritative found receipt. It never resends based on a timeout or absence of local receipt. An accepted begin outcome is durable, but its dispatch hint is one-shot: the first response has `callPermitted:true`; same-ID replay returns that stored acceptance with `callPermitted:false,replayed:true`. This transport-local response hint also handles concurrent duplicate begins. A lost first response requires querying; it does not reissue permission. A production distributed exactly-once dispatcher is outside this experiment. Unknown plus provider not-found remains unresolved; the model intentionally does not invent a terminal-failure proof.

The provider process can be killed before or after its commit independently of Integration and Execution. This exposes the receipt gap: provider commitment can exist while Integration remains unknown and Execution remains effect-blocked. Query/reconciliation converges the three contexts without a cross-context database transaction or blind external retry.
