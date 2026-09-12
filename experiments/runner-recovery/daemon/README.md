# Disposable daemon journal and loopback transport probe

Run with Python 3, Git and Linux (uses `flock`, process groups, `SIGKILL`, and `pidfd`):

```sh
python3 experiments/runner-recovery/daemon/probe.py suite
```

The script creates fresh temporary Git repositories and SQLite databases, starts
actual worker/child processes, and hosts a real HTTP listener on `127.0.0.1` with
an ephemeral port. No model, account credentials, remote repository, provider or
production application is used. All child work is a durable local launch counter
and a tiny Git commit. `evidence.json` contains source SHA-256, exact runtime
versions, every child/worker trace and full journal/service fixture snapshots.
Each execution creates a separate temporary evidence work directory; the source
never resets, commits in, or pushes the user's project.

## Minimum protocol illustrated

1. Execution first records a finite grant and charges its invocation. The service
   fixture starts with this already accepted grant; daemon receipt cannot admit or
   charge another invocation.
2. Register the durable daemon journal incarnation to its runner. Reconnect sends
   that incarnation and command/state/process summaries. Replacing or losing the
   journal pauses reconciliation. The known issued grant is not treated as new.
3. One daemon owns the local runner lock. The inbox command identity includes
   tenant, runner, run, occurrence, attempt, generation and command. An additional
   unique invocation key omits generation and command, preventing another command
   or fence from silently reusing the same attempt. The immutable digest covers
   the scoped command, payload and grant. Changed content conflicts; recorded
   rejection verdicts remain rejected on replay.
4. Commit `received` in SQLite WAL mode with `synchronous=FULL` before acknowledging
   a daemon receipt. The service can separately record this receipt. Neither local
   receipt nor receipt acknowledgment means a completion was accepted by Execution.
5. Check the current fixture cancellation/generation and finite grant before launch.
   Commit `dispatch_unknown` plus a unique process instance before spawning. There
   is no automatic relaunch from this state after restart, including the window
   where the daemon died before actually spawning. A conservative recovery pause
   covers both zero-launch and one-launch possibilities.
6. Record observed child PID/process instance, wait for the child, flush Git files,
   and commit the verified-input checkpoint record. Keep the original failing
   baseline and recovered working checkpoint separate. Commit an immutable result
   before sending it to Execution. A checkpointed result can be reconstructed
   deterministically without another native invocation.
7. Execution accepts/rejects the result in a separate transaction. Disconnect after
   this commit and before HTTP response leaves the daemon uncertain, but replay
   returns the same verdict. An accepted result retains acceptance after expiry or
   replacement; a new stale result only records a historical observation. A local
   result ACK is then recorded separately.
8. Cancellation and expiry prevent later admissions; they do not stop an existing
   customer process. A stop report names the exact command assignment, generation,
   attempt, registered journal incarnation, process instance and PID. This fixture
   derives exit evidence from the actual child's Linux pidfd. Stale or unrelated
   process reports cannot stop the replacement assignment. This is only evidence
   about the one local fixture process, with no claim of external effect absence.
9. Fresh reconstruction first clones and checks out the recovered commit, validates
   both commit objects, reference reachability, baseline ancestry, pinned input,
   allowlisted artifact path and SHA-256 content. Admission binds the verifier's
   exact manifest and expected-input digests to the command, requires an explicit
   recovery class, a fresh attempt/generation, proved stopped prior writer and
   remaining budget. A duplicate accepted grant is charged once.

## What the evidence exercises

Twelve deterministic `SIGKILL` boundaries cover before/after receipt, before/after
launch intent and spawn, invocation marker, child completion before checkpoint,
checkpoint/result persistence, and before/after service result acceptance and
local result ACK. Each barrier prints its trace then stops the process; the parent
observes the stopped state with `waitpid(WUNTRACED)` and sends `SIGCONT` or actual
`SIGKILL`. The safe detached child can survive daemon death.

Four actual loopback disconnect cases close the TCP connection before and after
the service receipt/result commit. Durable replay recovers each without another
native invocation. Additional cases cover overlapping daemon processes, command
and result conflicts, same attempt with another command ID, persisted rejections,
expired/cancelled prelaunch grants, result replay after expiry/replacement, journal
loss, stale result/stop reports, and real cancellation followed by pidfd exit proof.

Git recovery tests use distinct real commits and a fresh clone/checkout, not a
boolean checkpoint assertion. They reject a bad artifact digest, wrong repository,
wrong baseline, changed pinned input, widened artifact scope, missing commit object
and unreachable checkpoint. Dirty source working files do not enter the fresh
checkout. Recovery admission rejects a mismatched verified manifest, wrong class,
missing verification, reused attempt and exhausted budget; durable replay does
not recharge an accepted recovery. Correcting a rejected admission under its old
command ID does not turn the prior verdict into permission.

## Explicit limits and assumptions

- SQLite service state is a controlled fixture. This does not reprove or replace
  ADR 0003's PostgreSQL experiment, nor implement the full interpreter.
- HTTP is genuine loopback delivery but lacks authentication, TLS, replay-window
  enforcement, signed envelopes and cross-machine networking. Connection closes
  are controlled injection, not a real tunnel implementation.
- The fixed-schema Python JSON serializer is only a toy digest scheme. Production
  canonical serialization, signing, tenant authorization, admission APIs, clock
  skew and cryptographic grant/receipt provenance remain unproved.
- SQLite/`fsync` and actual killed processes provide process-crash evidence. Disk
  loss, power loss, filesystem corruption, container/host reboot, network storage
  and full HA guarantees are not tested.
- `flock` enforces one cooperating daemon for this local lock path. It does not
  restrain hostile daemons, alternate paths, other machines or customer principals.
- The service trusts the fixture's process and verifier reports. Exact identity
  correlation and real local observations are checked here; authentication and
  attestation/provenance require production adapter work.
- A daemon crash in `dispatch_unknown` deliberately pauses even when later files
  suggest completion. Fresh recovery requires independent verified reconstruction
  and writer accounting; absence of a result or marker never grants another spawn.
- The local repository identity is a trusted fixture label, not cryptographic
  proof of the remote repository. Production repository/commit fetch provenance,
  object filtering and Git configuration isolation are separate adapter work.
- The pidfd probe proves termination of one safe child process. A real harness can
  have surviving descendants, escaped processes, direct credentials and in-flight
  remote effects. Expiry, server fencing, cancellation and local exit cannot prove
  those remote effects absent. Native Codex and provider publication are separate
  probes; this fixture certifies neither.
- The fresh reconstruction probe verifies the workspace and admits/charges the
  replacement grant. It does not run the complete native recovery pipeline; the
  independent native-account probe supplies native harness compatibility evidence.

Independent review found and corrected the initial missing runner lock,
verification-to-command digest binding, and persisted rejection records. The
final evidence is regenerated from the final source; source hash in the JSON
must match the file when reproducing or reviewing it.
