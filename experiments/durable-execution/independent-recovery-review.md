# Independent recovery review for wayfinder #7

Date: 2026-09-12. Scope: the single claimed durable-substrate decision [#7](https://github.com/09millarda/agents-assemble/issues/7), against ADR 0001/0002, `CONTEXT.md`, and the #6 conformance report. This is an independent review of the disposable persistence fixture, not production certification or another decision ticket.

## Review approach

The reviewer read the contract and proposed an acceptance matrix before inspecting the worker: producer/consumer crash atomicity; same-ID payload conflicts; Human response versus Execution acceptance; frozen membership/waits; durable budgets/backoff; stale assignment fences; source gaps; publication receipt loss; independent cancellation/workspace/effect obligations; and fresh successor admission with inherited delivery identity.

The executed probes below used a separate disposable PostgreSQL 17.9 container, isolated from the parent harness database. Every worker command launched a fresh Node process and connected as the role owning that context. The test administrator inspected fixture records. The separate provider schema represents an independent remote system; no real Git, harness, account, PR, or external API was used.

## Independently executed evidence

| Probe | Observed result |
| --- | --- |
| Open a human wait while a writer lease is active. | Rejected with `writer_active`; the writer remains owned. |
| Stop generation 1, verify reconstruction, acquire generation 2, then deliver another stop for generation 1. | Stale stop rejected with `stale_generation`; generation 2 survives. |
| Reconstruct a stopped writer and acquire its replacement. | Reconstruction verification does not itself debit an invocation; two actual runner admissions produce `work = 2`, `attempts = 2`. |
| Repeat an accepted `beginEffect` with the same command ID. | First response has `callPermitted: true`; replay preserves accepted effect identity but has `callPermitted: false, replayed: true`. |
| Issue a publication intent, cancel, and only then deliver that intent to Integrations before its grant expires. | Reservation and begin can succeed under the already-issued grant. Execution remains `cancellation_pending` while the publication is unknown. |
| Provider succeeds after cancellation; Integrations records its receipt before Execution observes it. | Cancellation settlement rejects before receipt and after only the participant receipt commit. It succeeds after Execution accepts its own publication receipt transition. |
| Use a structured manifest containing operation, commit, and policy. | That exact fixture manifest persists in the accepted approval and publication scope. This is not a proof of a complete production manifest serializer or authorization. |
| Observe an edit before Human response delivery, retain the original spec, then explicitly reissue the wait. | A new request identity/version permits a fresh Human response and eventual publication. The old request is preserved as superseded; both Human response records remain separately auditable. |
| Replay the rejected old response after reissue, or attach the old request identity to the new Execution version. | Durable replay remains rejected; the attempted identity/version substitution fails with `request_mismatch`. Reissue creates zero approvals until the fresh response is accepted. |
| Admit a run with a future persisted retry timer, then attempt direct `acquire` or early `fireRetry` in new processes. | Direct acquire rejects with `retry_pending`; early firing rejects with `retry_not_due`. |

The late-grant trace establishes a specific boundary: Execution's committed intent/outbox creates the publication obligation. Cancellation does not retroactively revoke that already-issued finite grant. Local participant observations cannot settle Execution's canonical cancellation state.

## Discovered failures and corrections

Early static inspection found that opening a wait could retain a live writer; stale stop messages lacked a generation check; reconstruction charged a second attempt before reacquisition; expiry had no persisted transition; and budgets initially covered only runner acquisitions. The parent/worker amended these behaviors. The first three were independently executed successfully above. The parent suite owns the expiry and expanded budget evidence.

An independently executed counterexample exposed a further liveness hole:

1. Open an approval wait at Execution version 1.
2. Observe a specification edit at version 2.
3. Reject the old version-1 reply.
4. Retain the pinned original specification, advancing to version 3.
5. A fresh version-3 reply still fails because the stored wait expects version 1. Reopening the wait and acquiring work both fail with `human_wait_open`.

The old response correctly failed to approve, but the same-run retain path had no way to obtain a fresh response. The parent assigned a narrow explicit wait-reissue correction with a fresh request identity and preserved historical request state.

**Independent post-fix verification passed 22 assertions** across the repaired cross-context wait path and persisted retry bypass checks. The reviewer opened separate Human records for both request identities, accepted the old reply locally after Execution observed the edit, delivered and rejected that reply, retained the original spec, and invoked explicit `reissueWait`. The old wait remained in `waitHistory` with `status: superseded`. Replaying its already-rejected message did not approve; substituting the new version into an old-identity reply also rejected. Only a newly accepted Human response to the new request allowed Execution to authorize publication. Final work was 3: two Human invocations and one Integration invocation. Both Human responses remained stored. No old approval was copied or manufactured.

The parent additionally identified and repaired direct `acquire` bypassing a persisted retry timer. Independent fresh-process calls now reject both direct acquisition while a retry is pending and `fireRetry` before its stored deadline.

## Boundaries on the verdict

The protocol relies on trusted relay provenance (`transportVerified`), trusted checkpoint verification, and authoritative revision reconciliation supplied by the fixture. These booleans are not authentication, Git verification, or proof of source authority. Cross-context role isolation and local transaction behavior are distinct guarantees from those trusted boundaries.

Unknown publication plus provider `not_found` remains unresolved. An expired unstarted intent also has no definitive no-effect settlement protocol in this reduced fixture; safe blocking does not prove eventual recovery. A fence rejects stale Execution transitions but cannot stop a machine retaining direct credentials or undo an already accepted external request.

This reduced worker does not implement the complete occurrence grammar, package-versus-admission policy, all-join branch scheduling, both full #6 journeys, per-occurrence action retry contracts, or actual harness behavior. Its successor proves fresh admission/empty progress and delivery identity propagation, rather than complete bug-baseline and working-checkpoint semantics. Production deployment, multi-tenant authorization, throughput, database failover, and distributed dispatcher guarantees remain outside these probes.

**Review verdict:** no remaining blocking finding within the independently exercised reduced-model boundaries. The repaired wait liveness path and cancellation acceptance boundary are supported by real persisted transitions and separate worker processes. This is evidence for the candidate's feasibility, with the specific production and complete-interpreter guarantees above still unproved.
