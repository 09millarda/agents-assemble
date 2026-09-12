# Disposable stop-receipt/admission protocol experiment

This throwaway model investigates issue #9's durable stop-receipt and automatic-takeover gate. It uses only the Python standard library and is archived separately from production code. Run from this directory:

```sh
python3 probe.py suite --output /tmp/writer-stop-protocol-rerun.json
```

The archived run passes **90 scenarios**, including **five real child-process SIGKILL barriers**. The JSON records every scenario's complete service, daemon and supervisor-fixture state, plus the state immediately after death for crash scenarios. The source SHA-256 embedded in the evidence is `ff1c003035d012260b9d65c14064622de09e2c5311c4d27940656c7d04fba736`.

## What is real and what is modeled

Three separate SQLite WAL journals with `synchronous=FULL` model Execution, the customer daemon and an independently persistent supervisor. There is no shared transaction across them. Child workers stop themselves at an observed barrier; the parent verifies that barrier and sends SIGKILL. Reopened daemon journals reconcile the same request/receipt. Crash evidence therefore exercises actual process death and local durable commit boundaries, with no timer race deciding which write happened.

The supervisor's process count, scope identity, stop capabilities and scope completeness are **controlled fixture values**. This suite starts no native harness or writer process and proves no Linux containment. Native App Server and OS/systemd experiments are separate evidence paths. The service is a SQLite fixture, not the production PostgreSQL state machine selected in ADR 0003.

The authenticated transport principal and enrolled issuer/profile registry are also controlled inputs. The model distinguishes trusted transport metadata from an issuer claimed in a payload, scopes inbox identities by authenticated principal and rejects unsupported target/profile bindings. It does not implement enrollment, cryptographic authentication, revocation, anti-rollback journals, retention or a production tunnel.

The checkpoint verifier checks an exact predeclared manifest and actual immutable fixture artifact bytes. Baseline and Git commit references are fixture values, not a real Git checkout verification. External effects are a separate durable `unknown`/`accounted` obligation; provider reconciliation itself is modeled.

## Contract exercised

- Bind receipts to all 25 immutable target fields, including enrollment, journal incarnation, assignment/generation, invocation/attempt, host/boot, supervisor authority/instance/launch and exact scope object. Seven scope-instance substitutions, including an empty replacement scope, remain unknown.
- Commit a local stop gate before acknowledging the request. Serialize it with launch intent; a stopped invocation or changed journal cannot launch the old admission. A fresh journal cannot generate a receipt for the old scope.
- Keep complete-scope termination, prelaunch `never_started`, known-process exits, surviving writers and unknown scope distinct. Missing scope, incomplete scope, missing capability, missing trust, restart routes and wrong observation identity do not settle the local-writer obligation.
- Serialize receipt allocation before reading its existing value, persist the first immutable observation before transmission, and reject reusing its ID for another request. Concurrent observers receive the same persisted receipt. Exact accepted/rejected replays retain their first verdict; changed content conflicts. A late receipt settles only its named historical writer. Neither an old stop request nor an old receipt changes the replacement writer.
- Admit fresh recovery only from the exact current writer/generation of its occurrence, after all required writer/effect obligations in that occurrence are accounted, exact manifest/input verification, current trusted replacement runner/profile/journal eligibility, an approved recovery class, a new invocation/attempt/scope and a finite nonexpired grant within allowance. Accepted replay charges once; rejected replay cannot become accepted after conditions change.

Separate occurrences are assumed to have declared nonconflicting resource scopes in this bounded model; their writers and effects do not block each other. A production shared-workspace/resource conflict policy is outside this fixture. The run shares an allowance while each occurrence owns its current writer and authoritative generation.

Independent review found and corrected a reachable stale-predecessor hole: after admitting writer 2, a new writer 3 could previously cite stopped writer 1 and its checkpoint. The current-writer anchor now rejects that request, and additional same-occurrence writers/effects cannot be omitted by choosing a different predecessor. Review also added replacement eligibility checks and serialized receipt creation; regressions cover each finding.

The historical-receipt isolation scenario deliberately seeds an active replacement without running the gate, to prove the old receipt cannot mutate it. That test setup is not a valid takeover path.

## Real crash boundaries

| Barrier observed before SIGKILL | Durable state on restart |
| --- | --- |
| Before stop transaction commits | No committed gate or receipt; original request redelivery commits the gate. |
| After stop transaction commits | Gate survives; no receipt exists yet. |
| After supervisor-fixture stop, before receipt | Independent fixture scope is terminal; daemon reobserves the exact original binding. |
| After receipt commits | Same immutable receipt and unacknowledged outbox survive. |
| After Execution accepts, before daemon records reply | Execution returns its original acceptance; daemon acknowledges the same receipt. |

All five leave the independent remote effect unknown, retain the original admission charge and refuse a new launch during reconciliation. The test kills an owned child process using its live subprocess handle; it does not use PID reuse as stop evidence.

## Interpretation and limits

The suite supports the proposed receipt shape, replay behavior and conservative admission predicate under its explicit trusted fixtures. It does not certify the complete production service/daemon/supervisor composition, a production local journal or arbitrary malicious inputs. The code is intentionally not a complete schema/API implementation.

A successful `scope_stopped` fixture value depends on the real adapter establishing exact identity, complete local writer scope and disabled restart/recreation. If the OS/native experiments cannot establish that profile, these passing protocol scenarios **do not enable automatic takeover**. Direct credentials and remote execution/effects remain independently unresolved even after sufficient local stop evidence.
