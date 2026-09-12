# Throwaway Linux writer-supervision fixtures

Question: can a transient user service contain harmless local descendant writers
after their process group, submitting daemon, or main process dies, and what does
its emptiness actually prove?

This is disposable experimental code for decision #9. It is not a production
supervisor, portable backend, native Codex compatibility test, or release gate.

From the scratch worktree root, run one command:

```sh
python3 experiments/writer-supervision/fixtures/throwaway_fixture.py
```

The standard-library Python script writes `run-<uuid>/evidence.json` and fixture
identity/heartbeat files beside itself. It needs Linux cgroup v2 and a running
systemd user manager supporting `Type=exec` and `ExitType=cgroup`. The observed
host used Linux 7.0.0-31-generic, systemd 259.5, and Python 3.14.4. No sudo,
persistent service configuration, source edits, or network requests are used by
the writer fixtures. Every fixture writer expires after 20 seconds. Every transient service also
has `RuntimeMaxSec=20s`, `TimeoutStopSec=750ms`, `KillMode=control-group`,
`SendSIGKILL=yes`, `Restart=no`, an explicitly empty `RestartForceExitStatus`, and
`Delegate=no`. Those settings are captured from the manager, not only requested.

Units have unique `aa-writer-fixture-<uuid>-<case>.service` names. Cleanup addresses
only those exact names, or a directly owned PID whose boot ID and process start
ticks still match. The external-unit case deliberately launches a second,
explicitly owned transient unit, then stops that sibling separately. It never
discovers or stops unrelated services. Do not interrupt the harness unless
necessary; its finalizer stops and resets its exact owned units. Worker and unit
runtime bounds limit the lifetime if the harness itself dies.

## Recorded result

`run-20260912-final/evidence.json` contains **6 passing empirical scenarios**:

| Scenario | Observed result |
| --- | --- |
| Process-group kill after `setsid()` and double fork | Main died; detached writer continued appending. |
| Kill only the service main PID | With `ExitType=cgroup`, the same invocation remained active and populated; its detached writer continued. |
| Stop the service with writers ignoring TERM | Stop escalated to KILL; known writer ended and heartbeat stopped. |
| Kill the submitting fixture daemon | Service, cgroup inode, and InvocationID survived; a new observer rediscovered and stopped it. |
| Explicitly restart a service with `Restart=no` | Unit name remained; InvocationID changed. `Restart=no` prevents configured automatic restarts, not an explicit restart request. |
| Launch a sibling unit through the same user's manager | Outer cgroup reached observed `populated 0`; sibling writer still appended and required separate cleanup. |

Five instrumented stop calls completed in **0.799–0.967 seconds** on this host.
The harness held the original `cgroup.events` descriptor and sampled it every
2 ms during stop. Three stops captured `populated 1 → populated 0 → ENODEV`;
two captured `populated 1 → ENODEV` without an observed zero. Removal is therefore
a real observation race. A missing path, `ENODEV`, or a successful stop job must
not be fabricated into a raw `populated=0` observation. The evidence retains
exact samples, time offsets, unit properties, InvocationIDs, boot IDs, cgroup
inodes, process birth identities, and heartbeat byte counts.

The external-unit result is especially restrictive: even an actual observed zero
in the outer cgroup does not show that unrestricted same-UID code cannot leave a
writer elsewhere. Neither `Delegate=no` nor `KillMode=control-group` is a sandbox
against calling the user's service manager. The fixture can clean its sibling
only because the harness explicitly created and recorded that second unit.

The file also contains **3 modeled guard examples**, reported separately from
empirical cases: stale invocation identity gives `BLOCKED_UNCERTAIN_CLEANUP`;
observed outside-scope writer gives `BLOCKED_UNCERTAIN_CLEANUP`; a synthetic
missing-user-manager input gives `BLOCKED_CAPABILITY_UNAVAILABLE`. No real host
capability was disabled. These examples illustrate a proposed fail-closed
protocol and do not test an implemented production protocol.

No cleanup receipt is certified by this harness. It observes local process and
manager behavior; it does not establish closed-world tool containment, durable
admission closure, broker authority, or production recovery correctness.

The earlier `run-20260912-initial` is retained as failed-harness evidence. A
relative fixture path resolved under the user service's default home working
directory, so readiness timed out. The exact owned unit was stopped, its owned
output moved back into that run directory, and the empty created parent
directories removed. The runner now resolves the output path before launch.

At final verification, all five final-run units were inactive/not-found, and no
observed PID with the same birth identity remained live. A reparented zombie may
remain visible under the host's existing subreaper; a zombie cannot write and is
not treated as a live writer.
