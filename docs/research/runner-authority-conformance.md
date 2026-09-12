# Enrolled-runner authority experiment

Date: 2026-09-12 · Decision [#10](https://github.com/09millarda/agents-assemble/issues/10) · Map [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Verdict

**Select outbound HTTPS with mutual TLS, a registered certificate-to-principal binding and current application authorization for the bounded reference transport.** Execution owns immutable receipt verdicts and independently gated recovery. [ADR 0006](../architecture/0006-enrolled-runner-authority.md) specifies the contract; the [source review](runner-authority-sources.md) compares alternatives and separates source facts from application choices.

This experiment asks whether the service can distinguish real enrolled senders, scope their receipts correctly, preserve historical verdicts through rotation, and refuse unauthorized or uncertain recovery. It does not ask whether an unrestricted same-user native workload can be trusted to attest itself.

## Archive, results and reproduction

The [disposable source, complete snapshots and browser lab](https://github.com/09millarda/agents-assemble/tree/5a0f208/experiments/runner-authority) are archived at `5a0f208` on `codex/prototype-runner-authority`. The final fixture passes **69 scenarios with 219 checks**; the [independent HTTPS review](https://github.com/09millarda/agents-assemble/blob/5a0f208/experiments/runner-authority/review/results.md) passes **52 boundary cases**. Both record the same executed source SHA-256, `28eced26fa319f7676ec400c00ee1e1707c423309fc3dbc8c7f49f1129cc68dd`. The earlier five regression cases overlap the final 52 and are not additional unique cases. Source-review repairs landed before the independent regression run; no failing pre-repair network run is claimed.

Measured runtime: Python 3.14.4, OpenSSL 3.5.5 and SQLite 3.46.1. In the archive's experiment directory:

```sh
python3 fixture.py --output evidence.json
python3 review/probe_boundary.py
python3 viewer/build.py
```

The commands create only temporary local credentials and loopback fixtures. The first two perform the actual authentication probes; the last bundles their evidence with the illustrative standalone `runner-authority-lab.html`. Final source/evidence hashes, scenario counts and absence of archived private keys/certificates were checked. Browser inspection verified unknown-effect refusal, old-receipt isolation from a replacement and the recorded same-user impersonation result. Local Markdown links and whitespace checks passed.

## What was exercised

| Boundary | Evidence and interpretation |
| --- | --- |
| TLS client/server authentication | Real TLS 1.3 rejects an absent client certificate, a foreign client CA and an actually expired certificate. The client rejects an unexpected service hostname and CA. A CA-valid but unregistered certificate passes cryptographic trust and fails application enrollment authorization. |
| Registered sender and operation scope | Distinct enrolled identities cannot substitute runner, tenant, deployment or payload issuer. A caller-controlled principal header has no effect. A transport-only runner role cannot submit observer evidence. Recovery requests require their own checks against the selected writer's tenant and runner. |
| Immutable receipt acceptance | Exact receipts commit their verdict, permitted writer state and outbox together in an Execution-local SQLite transaction. An injected failure before the outbox insert rolls back the whole transaction. A dropped HTTP response after commit is recovered by identical replay without another transition. |
| Rotation, revocation and history | An already-open TLS connection is denied on its next operation after credential revocation or actual certificate expiration; the latter uses a real short-lived certificate and preserves the same socket. A separately authorized replacement certificate can query and replay the unchanged historical receipt; a revoked or expired credential cannot. Historical work-grant expiry does not erase accepted history. |
| Journal and scope continuity | Replacing a journal or changing a registered boot does not permit a fresh receipt for the old scope. Restoring an older actual SQLite journal snapshot is detected when it reports below the service's acknowledged high-water mark. Accepted historical verdicts remain queryable after journal loss. These checks do not attest an honest local journal or detect every possible rollback. |
| Independent recovery obligations | A stopped writer still pauses at unknown effects, missing checkpoint verification, changed artifact bytes, quarantined evidence or exhausted allowance. A fully satisfied controlled fixture admits one new invocation; replay cannot charge again, and a stale predecessor cannot authorize the current replacement. |
| Same-user impersonation | A separate local subprocess reads the disposable observer key, changes its journal and submits an authentic mTLS receipt. The registered unrestricted profile records only an authenticated scoped observation and remains ineligible for recovery. |
| Revocation cutover race | A deterministic callback revokes Fleet authority after authentication but before Execution acceptance. That already-authorized request commits; its next operation fails. This positive race result establishes why immediate cross-context withdrawal must not be claimed. |

The registry and observation artifacts are provisioned by explicit fixture-controller operations, not an exposed administrator enrollment API. Both rotation keys already exist before the lifecycle probes; issuance, proof-of-possession enrollment and lost renewal acknowledgments are not exercised. The client fetches a grant through the authenticated service and checks its bytes, scope and bounds. No native work is launched. HTTP reconnection and durable local records are exercised without killing/restarting a service or observer or proving power-loss recovery. The rollback probe submits a fixed binding's lower sequence after restoring the database; it does not implement autonomous discovery of missing local journal entries or authenticated production high-water synchronization.

Unseen receipts require the fixture's active combined receipt/recovery grant. The historical-replay probe does not prove first delivery under a separate reconciliation authority after the original work grant expires. The positive recovery uses one pinned runner and a controlled verifier; general runtime, recovery-class and destination selection remain outside the fixture. The runner parser checks the returned grant's digest and expected binding; service-side authorization checks the logical observer, but the parser does not independently compare an expected observer identity. This is not full native prelaunch conformance.

Review exposed missing checks in the first model: recovery needed to compare the authenticated tenant/runner with the selected writer, validate the current destination incarnation, and keep shared logical runner state consistent across rotated keys. These are separate from the receipt endpoint's checks. The final protocol requires each operation to authorize its own target, treats rotation as a credential change within one logical identity, and refuses recovery into a stale binding.

## Evidence boundaries

Actual TLS handshakes and HTTP requests exercise peer authentication, server identity verification and current registry checks. The local certificate authority and disposable client keys are fixture-only credentials. They are generated in a temporary private directory and excluded from the archive. No customer/native model-account files, service credentials or installed harnesses are accessed.

The fixture's durable service state and runner journal are reduced models. Their accepted verdicts and local transactions are not a new PostgreSQL, cross-context, native-supervisor or production enrollment proof. [ADR 0003](../architecture/0003-durable-execution-and-recovery.md) remains the production PostgreSQL decision. Previously recorded native cgroup observations in [#9](native-writer-supervision.md) are not retrospectively authenticated by this experiment.

A trusted complete observer profile is a controlled positive fixture input. The negative same-user example establishes why credential possession and receipt authenticity cannot validate local observation truth. No claim is made that mTLS, a mode-0600 key, a separate process or a receipt signature isolates arbitrary native tools.

The protocol distinguishes authentic scoped evidence, complete writer coverage, external-effect accounting and exact checkpoint verification. Fixture artifact digest checks do not repeat [#8's native Git reconstruction](runner-recovery-conformance.md), certify a production verifier, or cancel a provider effect. Fresh admission remains Execution's own conditional transition.

## Scope retained for later work

- Administrator authentication, single-use enrollment UI/bootstrap, production certificate issuance/renewal and recovery of a lost enrollment credential.
- Durable runner grant/stop inboxes, authenticated stop-command delivery, prelaunch revalidation and integration with a real launch/stop gate.
- Fleet-to-Execution authority permits, ordered revocation gates and effective cutoff acknowledgments across real context-owned PostgreSQL transactions.
- A protected observer's credentials, journal and command interface; durable native retained-scope recovery; complete writer coverage and capability confinement.
- Full daemon installation, real native harness waits, publication adapters, remote effects, offline clock conversion, power loss, HA, retention and broad operating-system support.
- The owner-selected first-release journey (#4) and license/parity policy (#5).

The standalone browser lab contains illustrative free-play and guided scenarios plus the measured fixture records. Model button presses are never included in empirical scenario or assertion counts.

The new technical frontier is [#11, protected observer authority and native recovery continuity](https://github.com/09millarda/agents-assemble/issues/11). It must test actual denied credential/journal access and authenticated retained-scope recovery; a registry flag cannot substitute for enforced protection.
