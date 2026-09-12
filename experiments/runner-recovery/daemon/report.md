# Daemon recovery fixture verdict

The final run passed **26 scenarios**. Source SHA-256:
`4e7634ac5e8f16bdec73c4eebf9d3252229614015be1568da7c7b449948e08f6`.
Runtime: Python 3.14.4, SQLite 3.46.1, Git 2.53.0, Linux.

Reproduce with `python3 experiments/runner-recovery/daemon/probe.py suite`.
[Source](probe.py), [full states and traces](evidence.json),
[protocol and limits](README.md).

| Failure/constraint | Observed outcome |
|---|---|
| Death before durable receipt, after receipt or after receipt ACK | Restart completes with exactly one safe child launch. |
| Death after durable launch intent, before actual spawn | Zero launches; restart pauses because durable evidence cannot safely distinguish this from the spawn window. |
| Death after spawn, invocation marker or child completion before checkpoint commit | The existing safe child completes at most once; restart pauses without another launch. |
| Death after durable checkpoint/result, before/after service acceptance or result ACK | Restart completes by durable result construction/replay; exactly one safe child launch. |
| Real loopback disconnect before/after receipt/result service commit | Retained journal and stable identities recover by replay; exactly one child launch. |
| Two overlapping daemon processes | The second process fails the actual exclusive runner lock; no additional launch. |
| Duplicate command/result, conflicting payload, another command for the same attempt | Exact replay returns prior verdict; conflicts do not spawn or accept changed results. |
| Initially rejected digest/admission repaired under its old command ID | Prior rejection remains; changed payload conflicts. |
| Unadmitted attempt with otherwise valid digest/generation | Service receipt rejects absent grant; daemon durably pauses with zero launches. |
| Expired or cancelled grant before launch | Zero launches. |
| Result first presented after expiry | Historical rejected observation only. Previously accepted result replay after expiry/replacement retains its prior acceptance. |
| Journal lost and automatically initialized with a new incarnation | Reconnect rejects the replacement journal; zero launches. |
| Daemon killed, grant expires while safe child is alive | The real child continues and writes local files. Server fencing/expiry is not process termination. |
| Cancellation followed by Linux pidfd termination observation | The scoped current stop report is accepted for one fixture process. Stale/unrelated process reports are rejected; no external-effect-absence claim. |
| Verified fresh Git reconstruction | Original `status=FAIL` baseline remains distinct from recovered `status=RECOVERED` checkpoint; fresh checkout hashes match pinned artifacts and excludes dirty source content. |
| Tampered/wrong checkpoint inputs | Bad artifact SHA, wrong repository/baseline/input/scope, missing object and unreachable checkpoint are rejected. |
| Fresh reconstruction admission | Exact verifier manifest/input bindings, explicit recovery class, new attempt/generation and remaining budget are required. Accepted replay consumes one allowance; a third admission exceeds the fixture budget. |

This supports the conservative protocol decision: **durable receipt precedes local
ACK; durable dispatch uncertainty precedes spawn; uncertain spawn never licenses
automatic relaunch; verified checkpoints and durable results can be replayed;
fresh reconstruction requires new bounded admission.**

It does not certify the full daemon, PostgreSQL behavior, native Codex, remote
transport/authentication, signed provenance, power-loss durability, arbitrary
process-tree containment or real provider publication. The SQLite service and
reported verifier/process observations are trusted fixtures. Those explicit
limits are retained in the [README](README.md).
