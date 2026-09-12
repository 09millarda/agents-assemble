# Throwaway runner recovery protocol

Date: 2026-09-12. Investigation for decision #8 only. This is an experimental protocol contract, not a production daemon, wire schema, security proof or release commitment.

## Question

Can a customer daemon acknowledge and recover an assignment without treating a reconnect, lost result, expired grant or process crash as permission to invoke the same logical work again? Can a fresh native harness session recover useful work from independently verified Git and artifact inputs?

## Selected boundaries to exercise

1. **Execution grant commit.** Execution alone admits a bounded invocation and owns its assignment generation and expiry. A transport send neither admits nor completes work. ADR 0003 supplies the production PostgreSQL transaction contract; this experiment need not reimplement that substrate.
2. **Daemon receipt commit.** The enrolled daemon durably records an immutable command and its invocation identity before acknowledging local acceptance. The acknowledgment means only that the daemon can account for this command after process restart. It is not proof of harness start, completion or Execution acceptance.
3. **Launch uncertainty commit.** Persist an intent before calling the native harness. The interval between that commit and receiving/persisting a native invocation identity cannot be made atomic with a local transaction. Restart in this state must not spawn again. Query/attach only when the adapter can prove the exact existing invocation; otherwise pause for recovery.
4. **Daemon result commit.** Persist the stable result envelope and checkpoint manifest before sending. After a lost response, replay the exact result and query its authoritative verdict. Do not generate a new result identity or invoke again merely to obtain a response.
5. **Execution result commit.** Execution independently validates identity, current authority, pinned input scope and result content in its own transaction. A local receipt, process exit, Git push or result transmission is not this acceptance. Rejected late results can inform a separately authorized reconciliation path without advancing the current attempt.

## Identity, grants and reconnect

Commands and receipts bind deployment/organization, enrolled runner, daemon journal incarnation, run, occurrence, attempt/invocation, assignment ID/generation, operation and command ID. Pin the immutable payload digest, definition/input scope, recovery class, runtime and environment profile references, grant expiry, and budget admission identity. The prototype may use a smaller synthetic schema; omitted fields remain requirements, not tested guarantees.

Maintain both a scoped command inbox and an invocation uniqueness rule: another command ID cannot independently launch the same attempt. Exact replay returns the recorded verdict. A payload conflict is quarantined. Deduplication must survive at least the full replay/recovery horizon; expiry alone is not permission to forget a previously launched invocation. Keep compact tombstones or require a service-confirmed retirement protocol.

Reconnect presents the same enrollment and durable journal incarnation, outstanding commands, invocation stages, checkpoints and result identities/digests. Reauthenticate independently of these identifiers. Execution returns current authority and authoritative result verdicts. Reconciliation never grants work. Unknown or missing journal state after previously accepted work is a recovery obligation. A replacement installation uses a new incarnation and requires explicit reconciliation/admission; it cannot claim to have never received the old command.

At receipt and immediately before invocation, check the applicable grant and pinned scope. A disconnected daemon receives no new grants; any continuation must have an explicit bounded policy. The service validates its own time. A daemon's local deadline should be conservative against skew/suspend and must be revalidated after restart; local time cannot prove service authority. A fresh/reconstructed invocation needs a fresh bounded grant and declared recovery class, charged once by Execution. Native resume cannot bypass admission or silently spend unbounded work.

## Cancellation and stopped-writer evidence

Cancellation records intent and stops new admissions. A stop request targets the assignment, attempt, generation and exact known local invocation/process supervisor identity. Keep requested, interrupted, locally exited, result accounted and external effects reconciled distinct. After local process termination, persist the bounded evidence before acknowledging it. A stale stop receipt cannot establish that a replacement writer stopped.

A native turn interruption or an app-server exit is weaker evidence than process-tree containment. Killing a parent PID does not prove all tool descendants stopped. Unknown process ownership, daemon journal loss and unavailable exact native invocation lookup require a pause. Direct downstream credentials can outlive the grant; no server fence, checkpoint, stop receipt or missing local log proves those external effects absent. Choose service-mediated publication and recorded effect reconciliation where strong publication control is required; the actual Git/PR receipt authority remains a separate adapter decision.

## Checkpoint contract

A checkpoint pins the registered upstream identity, original failing baseline commit, recovered working commit and tree, protected checkpoint ref/retention evidence, immutable artifact bytes and digests, accepted scope/context references, source invocation and generation, environment references and unresolved obligations. Preserve baseline and recovered state as distinct inputs. Secret values and native account tokens never belong in the manifest.

Publish required Git objects/artifacts, then verify through the destination retrieval path. Verify exact commit/tree identities, baseline lineage where the declared recovery class requires it, repository/upstream binding and artifact hashes. A ref name, local unpushed commit or boolean `verified` field is insufficient. Pin content after verification so a moving ref cannot change reconstruction. A checkpoint is unavailable when any required object or artifact is missing or mismatched. Submodules, LFS, untracked required files, services and toolchains require explicit declared support; this bounded probe uses plain Git text files.

If publication succeeds before a receipt is saved, reconcile the same ref/object/digest. Never advertise the checkpoint from local persistence alone. Fresh reconstruction creates an isolated worktree/clone at the verified working commit and supplies the exact selected artifact bytes plus the baseline reference. Record what context was restored. A new session recovering this work on the same host proves fresh-session reconstruction, not another OS, another machine or live native transcript migration.

## Evidence boundaries

Daemon fault probes use an isolated durable service fixture, actual local process death and controlled transport failures. Native compatibility is probed separately with the existing account and harmless local Git work. These results compose as architecture evidence, not as an end-to-end certified PostgreSQL/tunnel/native-harness stack. Fixture process termination does not certify native process containment. Transport authentication, secret delivery, grant signing, production replay retention, isolation, other harnesses and packaging remain unproved.
