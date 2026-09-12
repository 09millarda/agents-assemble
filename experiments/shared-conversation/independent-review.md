# Independent delivery-fixture review

2026-09-12. Reviewed `protocol.py` and `run_experiment.py`; added only `independent_probe.py`, this note and its JSON observations. No native sessions, parent-source edits, Git or GitHub mutations. Line numbers refer to the reviewed original source; later repairs may move them. The probe's first run failed because its local function shadowed the imported `concurrent` package; corrected before the recorded run.

## Final verdict after repair

**The focused repaired-fixture audit passes 10 scenarios and 36 assertions**, with zero failures. `independent_final_probe.py` and `independent-final-results.json` preserve the executable checks and combined source hash. These validate one-use dispatch under both concurrent and sequential retry, conservative permit loss on recovery, interrupt barriers before/after native acceptance, reserved interrupt capacity, numeric replay `[8,9,10]`, three-record retention and expired-cursor refusal, interrupt delivery after output retention rollover, historical successor isolation, and resistance to a captured stale receipt regressing terminal service state.

The authority-cutoff scenario deliberately expects a native effect when revocation occurs after intent. That passing assertion documents the fixture limit; it is not a revocation safety claim. Retention is record-count bounded only. Byte bounds, snapshot materialization, authenticated source tuple validation, and production authority/native-write atomicity remain outside this fixture and must stay explicit in the parent report. Within those stated limits the confirmed review defects below are repaired; no additional confirmed repair is outstanding.

## Original verdict and retained failure evidence

The original suite does not yet establish its intended no-duplicate-dispatch, interrupt barrier or bounded replay claims. Eight independent probes expose six actionable semantic defects and confirm historical-receipt isolation. The observations are in `independent-probe-results.json`; they are adversarial findings, not eight passing certification cases. Current authority is a controlled synchronous fixture input, not atomic production authorization.

## Concrete repairs

1. **Duplicate dispatch remains reachable (protocol lines 62–76, 97–99).** `intent()` returns `sending` both when this caller wins `received → sending` and when another caller already sent. `send()` consequently invokes the native side effect in both cases. After an initial native call and before receipt, calling `send()` again gives two native events. Two concurrent `send()` calls with a barrier after intent also give two events and both return accepted. Repair with a newly-acquired, caller-owned, single-use dispatch permit distinct from persisted status; only its winner may cross the native boundary. Recovery must consume uncertainty rather than recreate permits. Test both concurrent calls and sequential retransmission before acknowledgment. A claim string alone is insufficient if two callers can reuse it.

2. **Reordered interrupt delivery bypasses the later-input barrier (lines 58–60).** The service scan excludes earlier interrupts. Submit stop first and steer second, deliver only steer to the daemon: `intent(later)` returns sending. Include control barriers in ordering even when the control command has not reached the daemon, or atomically record a service stop gate that all steer dispatch consults.

3. **Interrupt acceptance leaves continuation open (lines 31–43, 51–61, 77–83).** After `send(stop)` returns accepted, a later steer is accepted while terminal is false. This races input into a cancelling turn. Close the targeted attempt/turn continuation gate durably when interruption is accepted for orchestration, not only after a native receipt. Retain earlier queued messages with explicit rejection/needs-rebinding outcomes. Native interrupt acknowledgment must neither reopen admission nor claim writer termination. If the intended product semantics deliberately allow input during cancellation, the contract must instead expose and investigate that race; it is currently unmodeled.

4. **Queue backpressure blocks stop (line 40).** Four queued inputs make `submit(stop, kind=interrupt)` return queue-full. Give safety/control delivery independent reserved capacity or a coalesced stop record for the exact target. Ensure unknown instructions and output pressure cannot prevent bounded interrupt/stop admission. The existing unknown-input bypass scenario does not cover full capacity.

5. **Replay returns lexicographic sequence order (lines 20, 113).** JSON serialization sorts string keys. With events 1–10, replay from cursor 7 yields payload sequence `[10,8,9]`. Sort numerically by stored sequence and include that sequence/source identity explicitly in returned envelopes. The original six-event replay test cannot detect this boundary.

6. **Output retention is a simulated cursor policy, not bounded buffering (lines 101–113).** All events remain stored; after 10 writes the log contains 10 items despite a nominal three-event replay window. There is no bounded snapshot, byte limit or source-pressure failure/stop path. Either implement a bounded disposable mechanism with explicit retained snapshot and gap semantics, testing that interruption remains available at overflow, or narrow evidence claims to cursor refusal only. A record-count cap alone will not bound arbitrarily large payloads.

## Positive result and evidence boundaries

The late-receipt probe sends input on attempt A, changes current scope to attempt B/generation 2, and then records/reconciles the old receipt. The old command becomes accepted; current successor scope stays B and `newAdmission` stays false. This supports exact historical status isolation in the modeled path. It does not prove production receipt provenance; native receipt identity is a trusted fixture operation.

The SIGSTOP-barrier/SIGKILL/reopen suite meaningfully exercises actual process death between SQLite commits. Its modeled native event count does not prove real native idempotency or compose authorization/native acceptance into a transaction. `gate()` reads authority before daemon intent, and native dispatch follows afterward. Revoking Alice after intent still produces one native event. This may represent the chosen admission cutoff, but the report must define that cutoff and explicitly retain the production bounded-grant/revocation protocol dependency. Do not claim rejection at every point before actual native write from a pre-gate revocation example.

The concurrent-submission scenario proves one durable input identity allocation; it does not prove a single dispatcher or one native write. The independent concurrent dispatch scenario demonstrates the distinction.

## Additional scope checks before stronger claims

`output()` authenticates only a journal string in this fixture; per-attempt/thread/turn attribution is not exercised. A successor using the same daemon journal can accept source payloads without their original attempt binding. Keep that as an explicit fixture omission or add structured source bindings and mismatches. `reconcile()` copies a snapshot status without a monotonic transition guard; a delayed snapshot could regress a newer service projection. These are code-review observations, not independently executed findings in the eight recorded probes.

The review does not request production infrastructure, broad hardening or a new architecture. Repairs should stay in the disposable state machine and accurately narrow the evidence where the mechanism is intentionally omitted.


## Final repair mapping

- Findings 1–4: independently verified repaired through fresh `dispatch-ready` ownership, consumed process-local dispatch claims, durable interrupt command barrier and separate interrupt queue capacity. No native deduplication was introduced into the modeled native journal.
- Finding 5: numeric sorting and explicit replay sequence envelopes verified at the first decimal-width boundary.
- Finding 6: three retained records plus expired-sequence refusal verified; full byte buffering and actual snapshot recovery remain explicitly unproved.
- Additional stale projection concern: parent added terminal verdict protection; an independently injected captured earlier daemon snapshot cannot regress an accepted service status.
- Original observations remain in `independent-probe-results.json`; final validation is separate. The first probe source describes the original API behavior and should not be mistaken for the final pass suite.
