# ADR 0013: protected observer and retained-scope recovery

Date: 2026-09-12
Status: **Accepted conditionally for scoped observation with a surviving protected keeper. Complete writer clearance and automatic takeover remain ineligible.**
Decision: [#11](https://github.com/09millarda/agents-assemble/issues/11) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Decision

Separate the Linux observer's privileged responsibilities from the native harness
user. For the bounded reference, retain the original delegated payload and its
open observation descriptor in a protected, independently surviving **keeper**.
A restartable **reporter** obtains that descriptor through an authenticated,
operation-scoped local interface, validates the original binding and closed
launch gate, reads the actual object, and records immutable evidence before
delivery. Use [ADR 0006](0006-enrolled-runner-authority.md)'s mTLS channel and
Execution-owned immutable receipt verdicts.

This resolves reporter restart with retained keeper custody. It does not certify
restart of every observer component, a host reboot, power loss, a production
daemon or an unrestricted native workload. If keeper custody or journal
continuity is lost, preserve `scope_unknown`; an old path, PID, inode, boot string
or unit name cannot recreate proof. Already accepted historical receipts may
still replay according to ADR 0006 without authorizing new observations or work.

Keep the current host profile at **authenticated scoped observation only**. The
experiment demonstrates direct protection against the tested workload operations,
but a same-UID helper can ask the user manager to launch a writer outside the
payload and regain ordinary supplementary groups. That writer continued after
the payload became empty. Complete coverage and indirect privileged-helper
authority remain unproved. A registry flag cannot turn these limits into a
trusted complete profile.

## Reference ownership and authority

| Component | Owner and responsibility |
| --- | --- |
| Host administrator | Trusted initial-namespace administrator; authorizes the reference setup and controls root code, system units, permissions and policy. Root/admin compromise is outside this software-only boundary. |
| Keeper | Root-owned transient system service in the experiment. Owns delegated cgroup creation, original descriptor custody, a protected journal and serialized one-launch/stop gate. Retains the payload after native exit; it never adopts an existing path as a fresh invocation. |
| Reporter | Separate root subprocess in the experiment. Checks custody and binding, observes the retained object and persists a receipt before delivery. It cannot grant replacement work. Production use may narrow the principal/capabilities after separate validation. |
| Native harness and tools | Existing ordinary OS user and native account. The reference direct workload starts with empty supplementary groups, no effective/permitted capabilities and `NoNewPrivileges`. Model authentication remains with Codex; no account files or provider credentials are copied into the observer. |
| Execution and Fleet | Existing context ownership from ADRs 0003 and 0006. The reduced service uses controller-provisioned enrollment and profile records; this is not a production enrollment or distributed revocation implementation. |

The [source comparison](../research/protected-observer-sources.md) considers two
profiles: a distinct service principal and administrator-enforced AppArmor domains.
Select the distinct-principal direction for this reference. AppArmor is neither
implemented nor rejected. The measured keeper uses root, not a newly created
service account. A same-UID process or mode-0600 file alone is insufficient.

The keeper interface authorizes the kernel-reported UNIX peer and exact protected
binding; it accepts no arbitrary signing payload, observation path or executable.
The fixture permits root control and refuses UID 1000 even when it presents a
validly shaped identifier. A wrong binding is rejected even from the root test
controller. `SO_PEERCRED` identifies a peer; operation authorization is application
policy. [Linux UNIX socket credentials](https://man7.org/linux/man-pages/man7/unix.7.html#DESCRIPTION)

The reference denies toy key access, journal mutation/replacement, protected code
writes, keeper signaling/memory/descriptor access, payload migration and tested
observer requests. A valid system-manager property mutation is also denied without
interactive authorization. These are measured operations, not a complete host
policy audit. `NoNewPrivileges` limits privilege gains through `execve`; it does
not prevent requests to existing privileged daemons.
[Kernel NNP semantics](https://docs.kernel.org/userspace-api/no_new_privs.html)

## Binding, launch and recovery

Bind deployment/organization, enrolled runner, journal incarnation, run/occurrence,
assignment/generation, attempt/invocation, admission/input digest and profile to
the original manager activation and retained scope. The keeper derives the
actual cgroup from its own process membership; the controller verifies the
manager's original activation and keeper PID. Names and numeric inode values
are recorded correlations, not standalone durable identities.

Fetch and verify a current exact grant through the authenticated service before
the single fixed launch. Persist launch uncertainty before starting the native
driver. Reject duplicate launch attempts. Durably close the stop/continuation
gate before requesting payload termination; preserve
[ADR 0004](0004-runner-assignment-and-checkpoint-recovery.md)'s uncertainty rules.
In this experiment the stop request is locally root-authorized. Production
service-to-runner stop transport and full admission integration remain open.

The keeper holds the original `cgroup.events` descriptor and sends it through
`SCM_RIGHTS` only to an authorized reporter. The reporter verifies the protected
journal/binding, live original manager activation, peer identity and closed gate
before reading it. A reporter restart must not kill or clean the keeper's payload.
The measured original descriptor survived two reporter lifetimes; this is
surviving-process custody, not recovery from a numeric descriptor stored on disk.

An open descriptor does not keep a removed cgroup live. The experiment received
`ENODEV` from the original handle after removal and again after an empty same-name
replacement was created. Reopening the replacement path would discard the
evidence boundary and is disallowed. Loss of the keeper also remains unknown.
[Kernel cgroup destruction](https://github.com/torvalds/linux/blob/v7.0/kernel/cgroup/cgroup.c#L5762-L5808)

The keeper compares its protected journal with retained in-memory state. Missing,
corrupt, substituted-incarnation and older records fail closed, including a
rollback still newer than the last service-acknowledged sequence. This supports
continuity while that keeper survives. It is not anti-rollback proof after losing
both memory and journal. The proposed systemd descriptor-store alternative in
the source comparison was not exercised and is not required by this decision.

## Receipts, evidence and coverage

Keep the full native observation separately from the exact canonical scoped
projection submitted through ADR 0006. The reporter derives both from the actual
original descriptor and protected binding. Durably create the receipt using
file and directory synchronization before sending it. An authorized replay sends
the unchanged bytes; it does not reobserve a missing payload or relaunch work.
Process-kill barriers exercise these orderings, not storage power-loss durability.

The composed experiment obtains an actual native writer, kills a reporter after
observation but before receipt persistence, restarts into original keeper custody,
kills again after persistence, delivers over mTLS with a deliberately lost
acknowledgment, and replays the same durable receipt. Execution records
`authenticated_scope_only` and rejects replacement admission as `ineligible_profile`.
The reduced TLS/SQLite server and its registry policy are fixture infrastructure;
they do not replace the PostgreSQL context-local contract.

Treat native-workspace files as untrusted inputs. The observer must not use
privileged reads of workload-selected paths to create evidence or expose protected
data. The experiment's initial reader had such a flaw; the final version pins a
root-owned workspace entry, rejects symlinks, nonregular/non-workload-owned files
and excessive input, and limits artifact fields. Repaired source and actual
fixture-sentinel rejection cases are retained in the
[conformance report](../research/protected-observer-conformance.md).

Even a correct scoped receipt leaves the complete writer obligation unresolved
without validated coverage of all write-capable routes. The same-UID/NNP user
manager probe is a concrete negative coverage result; it is separate from the
native tool sandbox, whose full confinement is not certified. Supplementary-group
reacquisition, privileged/container services, IPC helpers and remote executors
need explicit policy and evidence. No remote effect is canceled by an empty local
payload, and checkpoints still require independent verification.

## Consequences and remaining scope

Retain the root-separated keeper/reporter seam and conservative scoped fallback.
Keep automatic recovery admission gated by complete writer evidence, current
authority, independent effect reconciliation, verified checkpoints and budget.
Do not classify this reference as a certified hostile-workload sandbox.

Full keeper/manager restart, boot or storage loss, an independently protected
unprivileged service account, comprehensive helper/IPC policy, native sandbox
qualification, production enrollment/stop transport/revocation, installation,
retention and complete production integration remain open. These are retained
as map uncertainty rather than speculative implementation tickets.
