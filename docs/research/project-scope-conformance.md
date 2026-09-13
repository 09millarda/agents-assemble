# Project-scope permit and suspension conformance

Decision [#19](https://github.com/09millarda/agents-assemble/issues/19) · ADR
[0014](../architecture/0014-project-scope-and-run-admission.md) · map
[#1](https://github.com/09millarda/agents-assemble/issues/1).

## Verdict

The bounded ADR 0014 contract survives the exercised independent context
crashes, delayed/duplicated messages, archive/admission interleavings, permit
expiry, consumer restart, and suspension cutoff cases. No contract amendment is
required from this experiment.

This is reduced local conformance evidence, not production qualification. The
full interpreter, authenticated transport, provider/harness behavior, concrete
authorization adapters, integrated application, and release journey remain
unproved.

## Evidence

The disposable prototype is retained on scratch branch `codex/prototype-project-scope`
at commit `c53e09b`. It uses Node 24.21.0, `pg` 8.16.3, and a local PostgreSQL
18.6 instance on loopback. The controller creates three independently owned
schemas (`projects`, `execution`, `integrations`); context workers use separate
database roles and durable inbox/outbox tables. The controller is the privileged
fixture setup and transport relay, not application code.

The run produced 9 passing scenario groups, 55 passing assertions, 0 failures,
90 recorded message events, and a sanitized final-state snapshot for every
scenario. A separate `independent-review.mjs` pass checked the recorded result,
required scenario set, dedicated database name, and zero-failure verdict. The
run records SHA-256 source hashes and the PostgreSQL server version in
`results.json`.

| Contract surface | Observed result |
| --- | --- |
| Producer killed before commit | Permit, inbox, and outbox roll back; exact request retries. |
| Producer killed after commit | Permit and result survive; exact replay is stable; changed payload conflicts. |
| Archive versus admission | Archive remains `closing` until the durable Execution verdict; an already-issued permit may admit; accepted work and budget remain. |
| Expiry | Expiry alone cannot close archival; explicit `expired-unused` reconciliation closes it and cannot resurrect the permit. |
| Workspace failure | Failed preparation leaves an admitted run and charged history; admission replay does not charge again. |
| Suspension | Project policy epoch increments; all registered consumers must apply and acknowledge the cutoff before completion. |
| Consumer restart | Inherited authority is rejected until the current checkpoint is installed and acknowledged; event gaps are rejected. |
| Queued effects | Effects accepted before suspension remain independently `in-flight`; queued old-epoch effects are rejected after the acknowledged cutoff. |
| Independent holds and resume | A project resume uses a newer epoch, rejects stale resumes, and cannot clear Catalog/recovery-style holds. |

## Limits

The fixture models the selected boundaries and transaction protocol. It does not
prove authenticated grant contents, real message transport, external provider
effects, native writer stopping, multi-host failure, throughput, or production
schema/migration behavior. The local PostgreSQL version differs from the prior
Docker-only experiment convention; the result is used for transaction/fault
behavior, not version qualification.

Executable code remains on the scratch branch by design. Mainline retains this
decision note only.
