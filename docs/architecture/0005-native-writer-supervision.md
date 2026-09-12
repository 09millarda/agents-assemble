# ADR 0005: scoped native-writer stop evidence

Date: 2026-09-12
Status: **Accepted conditionally for the bounded Linux reference profile; unrestricted customer-runner takeover remains paused without complete writer scope and trusted receipt provenance.**
Decision: [#9](https://github.com/09millarda/agents-assemble/issues/9) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Decision

Use one manager-created systemd user service per invocation on the Linux reference configuration. For a directly observed terminal receipt, retain an owned, delegated `payload` cgroup containing the native harness and inherited tools, with a small trusted supervisor outside that payload. Stop the payload, observe the exact retained object's `cgroup.events` reporting `populated 0`, persist the receipt, and only then clean up the containing service.

This selects a reference supervision mechanism and a minimum evidence protocol. A receipt covers the declared payload, not all processes on a machine and not every activity caused by a tool. Settling Execution's complete local-writer obligation additionally requires an eligible profile that accounts for every potential writer. An unrestricted same-user process can ask another local service to run work outside this scope; the experiment demonstrates that case. Such configurations remain ineligible for automatic takeover unless that work is separately accounted for or an enforced capability boundary is validated.

Native interruption, parent exit, process-group signals, successful kill submission, missing units and lease expiry cannot alone settle a writer obligation. A local stop never settles unknown Git/cloud/provider effects. [ADR 0004](0004-runner-assignment-and-checkpoint-recovery.md) remains the receipt, launch-uncertainty and checkpoint baseline.

## Reference profile and alternatives

The measured profile uses Linux `7.0.0-31-generic`, systemd `259.5-0ubuntu3.4`, cgroup v2 and Codex CLI `0.153.4` App Server over stdio under the existing OS user and native ChatGPT login. No account credentials are extracted or copied. This does not choose the launch harness or OS.

| Mechanism | Decision and evidence |
| --- | --- |
| Parent wait / pidfd | Retain for exact-process observation. Both the previous probe and this session's native crash leave a tool writer alive after App Server death. A held pidfd identifies one process, not its descendants. |
| Process group / ancestry snapshot | Reject as complete writer scope. The local fixture's double-fork/`setsid` writer survives the original group's termination. PID namespaces also require explicit host/namespace correlation. |
| Whole transient systemd service | Useful cleanup boundary for inherited descendants. Real stops ended identified writers, including detached ones. However, collection can race observation: held event descriptors returned `ENODEV`, and a missing unit alone cannot recover a historical terminal fact. |
| Retained delegated payload | Select for the bounded direct-observation profile. The native probe captures `populated 0` on the same payload inode and unit activation before receipt persistence and outer cleanup. Require complete writer coverage independently. |

These distinctions follow the [kernel's cgroup-v2 process and subtree semantics](https://cdn.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html) and [systemd's delegation ownership model](https://systemd.io/CGROUP_DELEGATION/). The experiment supplies the version-specific observations; documentation is not adapter certification.

The containing service uses `Type=exec`, `ExitType=cgroup`, `Restart=no`, empty `RestartForceExitStatus`, `KillMode=control-group`, `SendSIGKILL=yes`, `FinalKillSignal=SIGKILL`, explicit finite `TimeoutStopSec` and `RuntimeMaxSec`, and `Delegate=yes` for the retained-payload variant. Verify effective properties rather than trusting launch arguments. Prevent alternate activation/restart and never reuse a stopped invocation's scope. `Type=exec` establishes launcher execution, not native initialization. Service deadlines are a cleanup backstop, not a proof of grant-clock conversion. See [service lifecycle](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) and [termination configuration](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html).

Only the adapter-owned delegated child may receive a direct `cgroup.kill` write; use the manager API for the systemd-owned outer service. The disposable shim launches once, performs successful child migration before native `exec`, and remains outside the payload after native exit. It does not enable subtree controllers; production use with controllers should separate `supervisor/` and `payload/` leaf cgroups. Its launch barrier and observer are trusted fixture code, not a hardened production security boundary.

## Identity and lifecycle

Execution retains one durable writer obligation for every accepted invocation. Bind it to deployment/organization, enrolled runner, journal incarnation, run/occurrence, assignment/generation, attempt/invocation, admission identity and immutable operation/input digest. Keep invocation uniqueness independent of command-message deduplication.

Before launch, journal a never-reused supervision scope ID and launch intent. Correlate it with the exact host/kernel boot, manager kind and user, manager-observed unit `InvocationID`, effective profile, and delegated payload object. Record native thread/turn identifiers as additional correlations. A cgroup inode and path are useful while their lifetime is continuously established; they are not permanent identities across deletion, reuse or reboot. Neither a workload-supplied `INVOCATION_ID` nor a claimed boot ID authenticates evidence.

If launch acknowledgment is lost, discover the original manager activation through the durable binding. Do not restart the same unit or retry native creation merely because the reply is absent. A changed activation, deleted/recreated path, missing/corrupt journal, boot change without an accepted reboot proof, or ambiguous lookup leaves the old writer unresolved. Pidfds do not survive a daemon restart as durable handles; reopening an old numeric PID does not recover the original process. See [pidfd identity](https://man7.org/linux/man-pages/man2/pidfd_open.2.html) and [manager unit properties](https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.systemd1.html).

Keep the terminal scope available until evidence is durable. If the daemon dies while stopping, a replacement observer recovers the stop gate and exact binding, then reconciles the retained scope. If the service deadline or whole-unit cleanup destroys that scope before a durable terminal receipt, record unknown scope. A production persistent supervisor/observer and its recovery path still require integrated validation; separate OS and durable-protocol probes do not establish that composition.

## Stop requests, receipts and replay

Execution's stop request carries its stable command ID/digest, stop reason/policy, exact writer obligation, full assignment/attempt/generation and scope-binding identity. The enrolled daemon verifies it and durably closes launch/continuation/restart admission for that invocation before acknowledging receipt. Serialize that gate with launching: an empty payload is not terminal if a queued launch may still enter it. Stops for old bindings must never resolve a target from whatever process or unit currently occupies a name.

Attempt bounded native interruption, then termination through the accepted supervisor policy. Preserve distinct observations for interrupt acknowledgment, terminal native turn, known process exit, live writers, subtree emptiness and scope completeness. The native graceful probe received an `interrupted` turn while its writer pidfd was still nonterminal at the next observation. That timing observation does not claim the interrupt could never finish; it demonstrates why its acknowledgment is insufficient.

Persist an immutable stop receipt before transmission. It binds receipt/request IDs and digests, authorized observer/issuer and profile, exact writer/scope binding, boot and activation, stop actions, terminal observations, evidence references, and explicit covered scope/limitations. Use typed outcomes:

- `never_started`: a durable launch gate and authoritative no-start evidence.
- `contained_local_processes_stopped`: exact retained payload empty with launch/repopulation prevented; eligible completeness evidence is additionally required to settle the whole writer obligation.
- `known_processes_exited`: partial process evidence, with unresolved scope retained.
- `writers_remaining` or `scope_unknown`: surviving work, missing capability, incomplete scope, identity loss or insufficient evidence.

Execution authenticates the issuer against the accepted enrollment/scope profile and records its receipt verdict in its own local inbox/state/outbox transaction. The disposable model trusts fixture issuers; hashes and matching identity strings do not prove production provenance. Stronger later evidence gets a new receipt, not edited bytes under an old identity.

Exact replay returns the original verdict, including after grant expiry or generation replacement. Changed payloads conflict. A late valid old receipt can settle only the exact historical obligation it names; it cannot mark a replacement writer stopped or authorize its work. Lost acknowledgments replay/query durable facts without relaunching. Journal loss or rollback creates a new incarnation and retains old uncertainty.

## Takeover and limits

Execution binds recovery to the current writer/generation for its execution scope; an earlier stopped predecessor cannot bypass a still-active replacement. It may admit a fresh bounded attempt only after every required old writer obligation is settled, required external effects are reconciled, the original baseline and working checkpoint/artifacts are independently verified for the pinned input scope, the recovery class is eligible, and current authority/budget can be committed. A verified checkpoint, newer assignment or expired lease does not substitute for any of those facts. The receipt observer cannot grant replacement work.

The native positive scope contains a specified harmless writer and the observed inherited native processes. It does not certify arbitrary plugins, remote MCP/executors, systemd/D-Bus requests outside the payload, container sockets, cgroup migration, same-user journal tampering, or malicious tools. The same-UID fixture demonstrates a sibling service continuing to write even when the original unit is empty. No general sandbox, credential revocation or provider-side cancellation is selected here. Native tool sandbox settings were observed, not audited as preventing every escape.

Missing delegation/kill/observation capability, incomplete coverage, surviving uninterruptible work, supervisor disappearance before evidence, uncertain effects, and unauthenticated receipts all keep automatic takeover paused. Whole-host reboot evidence, other kernels/systemd versions, other harnesses/OSs, service-account authentication, native human waits and end-to-end production integration remain unproved. First-release scope #4 is subsequently resolved in the [release contract](../first-release-contract.md), selecting Linux/Codex as the reference to qualify; these probes do not qualify that release. License/parity remains #5.

See the [supervision experiment report](../research/native-writer-supervision.md) for separate native, OS-fixture and protocol evidence. The next sharp trust question is [#10, enrolled-runner authority and authenticated grant/receipt provenance](https://github.com/09millarda/agents-assemble/issues/10); stronger writer isolation and broader packaging remain separate fog.
