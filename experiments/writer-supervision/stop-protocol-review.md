# Issue #9: proposed stop protocol and adversarial review

This is a protocol proposal against ADR 0003, ADR 0004 and the #8 runner-recovery report. It is not empirical certification of a Linux adapter. The parent investigation must populate the supported adapter/capability profile and measured evidence before acceptance.

## Verdict to aim for

Select a per-invocation supervisor boundary only for configurations in which the adapter can establish both **exact scope identity** and **writer-scope completeness**. Killing an App Server, observing its PID exit, enumerating descendants, or observing an empty currently named cgroup proves less. Keep automatic takeover paused when either condition is unknown. Process control and a general security sandbox remain separate concerns; however, the claimed writer scope must explicitly exclude or prevent escape capabilities before it can settle the entire local-writer obligation.

A cgroup-backed supervisor is a candidate for keeping ordinary inherited descendants together across parent death, double-fork and session changes. Its configured permissions, restart behavior and real native integration still need evidence. A bare process group or descendant snapshot cannot establish that arbitrary detached writers are stopped.

## Identities and authority

Persist a `writer_obligation_id` in Execution and an immutable accepted local scope binding before allowing native work. Bind it to deployment/organization, enrollment ID, runner ID, **journal incarnation**, run/occurrence, invocation/attempt, assignment ID/generation, admission identity and input/operation digest. Invocation uniqueness remains independent of command deduplication.

The local binding also contains a never-reused `supervision_scope_id`, adapter/profile version, stable host identity, kernel boot identity, supervisor authority/instance identity, supervisor launch identity, and the precise scope object identity. Native session/turn IDs and process PID/start identity/pidfd correlations are supporting observations; they are not the ownership key. Where systemd is used, record the verified manager/unit invocation identity as well as the unit name and observed cgroup identity. Names, filesystem paths, PIDs and opaque native thread IDs alone are insufficient. An adapter must describe how it proves the same object after daemon restart; otherwise restart changes the result to unknown.

Scope tokens are unique across all supported replay/retention history. Scope creation and discovery must not adopt an existing object merely because its path or name matches. Pinned object handles help live-process operations, but do not persist across daemon restart; a durable supervisor lookup/tombstone contract is still required. No re-creation or restart of that stopped invocation is allowed, and replacements receive new scope IDs.

Execution issues stop requests. Only the enrolled observer/supervisor authority named by an accepted local binding may produce scope evidence, and only for capabilities permitted by its recorded profile. Sender authentication, deployment/enrollment binding, revocation and replay protection are prerequisites; matching identifiers and hashes are not authentication. A fixture may model the issuer as trusted only if the report labels production receipt provenance unproved.

## Durable stop request and receipt

A stop request contains a stable scoped request ID and payload digest; issuer/operation; exact writer-obligation and command/admission identities; exact assignment/generation and invocation/attempt; the accepted local scope binding or its digest; stop reason; and the graceful/forced-stop policy limits. If no authoritative local binding is known, request reconciliation for the exact invocation first. Never turn a run-level cancellation into `kill whichever PID/unit now has this name`.

The daemon verifies the request against its durable binding, then commits a stop gate and inbox verdict before acknowledging delivery. This gate prevents first launch, native continuation, automatic supervisor restart and local re-creation of this invocation. It must serialize with launch authorization; otherwise an empty-scope observation can race a new launch. A stop request for an old binding never sets the stop gate on its replacement. Expired/revoked authority can still trigger permitted cleanup, but cannot authorize new work.

Attempt bounded graceful native interruption, then the selected supervisor's bounded termination if policy allows it. Separate native interrupt acceptance, parent exit, known-process exits, scope termination and remote-effect accounting. Observe the exact bound scope after termination, with no launch/restart/migration route able to repopulate it. A successful signal call is not a terminal observation.

Persist an immutable receipt before transmission. Include receipt ID/digest; issuer identity and capability/profile; stop-request ID/digest; all target binding fields or an immutable binding digest; observation boot/supervisor identity; relevant monotonic ordering/timestamps; interruption/termination actions and outcomes; evidence references; and one of these typed outcomes:

- `never_started`: durable launch gate plus authoritative evidence there was no native start. Absence of a receipt or an empty recreated journal does not qualify.
- `scope_stopped`: the exact original boundary has no remaining execution, cannot restart under this invocation, and the adapter's declared scope is complete for the local-writer obligation.
- `known_processes_exited`: only the identified processes have exited; does not settle unknown descendants or escaped writers.
- `writers_remaining`: identified execution survives or termination failed.
- `scope_unknown`: identity, completeness, capability, journal integrity or observation continuity is insufficient.

Include what is actually covered and explicit limitations. The receipt must never label remote provider state as stopped. Terminal receipts are stable observations, not mutable status rows; later stronger evidence gets a new receipt linked to its predecessor.

Execution durably records its own inbox verdict and accepts only evidence with the exact expected issuer, binding and sufficient profile. It records settlement against the named writer obligation. There must be no run-level `stopped = true` update that a stale receipt can apply to another writer. Late cleanup may reconcile its exact historical obligation; it cannot change a replacement's writer state or supply current admission authority. Exact receipt replay returns the original verdict across newer generations and expiry; the same identity with different bytes conflicts. Rejected evidence remains rejected on replay.

A lost acknowledgment causes retransmission of the same request/receipt, or query of the recorded verdict, not another launch. On daemon restart, recover the stop gate and pending receipt from the original durable journal before reconnect/launch. With a missing, corrupt or rolled-back journal, establish a new incarnation and preserve the old writer as unresolved until separately authorized evidence accounts for it. Do not fabricate a fresh empty old scope.

## Takeover gate

Execution alone admits a replacement in its own transaction after: required old writer obligations have sufficient terminal evidence; separately required external-effect obligations are accounted; the checkpoint and distinct original baseline have been independently verified for the pinned scope; a recovery class is eligible; and a new bounded attempt, assignment generation and invocation grant can be charged and committed. Checkpoint availability and grant expiry are not stop evidence.

Observe a different kernel boot only through an authenticated, adapter-supported host/boot provenance path. A trusted whole-host reboot can establish that processes from the prior boot no longer execute on that exact host, but does not settle remote or off-host execution. A changed journal ID, container restart or arbitrary claimed boot ID is not this proof. Until that path is certified, it remains a paused outcome.

## Edge-case matrix

| Event | Required handling | Automatic takeover |
| --- | --- | --- |
| Stop races receipt acceptance or first launch | Commit invocation stop gate atomically with local acceptance/launch authorization checks; either prove no start or reconcile the admitted scope. | Only with sufficient terminal evidence. |
| Crash after launch intent, before correlated supervisor start | Discover the exact prebound scope through an authoritative adapter path; never replay native start. | Pause if correlation is inconclusive. |
| Native interrupt acknowledgment arrives | Record delivery/interrupt stage; wait for sufficient supervisor terminal evidence. | Paused on acknowledgment alone. |
| App Server exits; tool child writes afterward | Parent exit is partial evidence; terminate/account the enclosing complete scope. | Paused while child/scope unresolved. |
| Tool double-forks, changes session or enters a PID namespace | Supervisor scope membership and stable scope identity must remain sufficient; bare PID/PGID mapping is insufficient. | Only if tested profile covers it. |
| Tool can migrate cgroups or launch through another manager/socket | Treat those capabilities as outside/incomplete scope unless separately prevented/accounted. | Paused for unresolved local writer scope. |
| Stop command is retried after reply loss | Replay stable durable inbox verdict; do not resolve target by current path/name. | Unchanged by replay. |
| Receipt accepted by Execution but reply is lost | Retransmit exact receipt; Execution returns prior verdict without applying a new transition. | No duplicate admission/charge. |
| Daemon restarts while stop/receipt is pending | Recover original gate/binding/receipt; reconcile exact supervisor instance; retry original receipt. | Paused until sufficient evidence is accepted. |
| Old PID reused by unrelated process | Do not signal or observe based on PID alone; require exact instance handle/correlation. | Paused if identity is lost. |
| Cgroup path/unit name deleted and re-created | Reject identity substitution; current empty replacement does not attest original scope. | Paused absent durable original terminal evidence. |
| Original scope disappears without terminal receipt | Require adapter-supported proof of original object's terminal lifecycle and scope completeness; `not found` alone is insufficient. | Paused by default. |
| Empty scope can be automatically restarted | Fence restart/recreation before terminal observation; emptiness alone is temporary. | Paused until lifecycle is closed. |
| Stale stop request or receipt arrives after replacement | Match the old obligation/binding; never signal replacement or mutate its writer state. | Replacement unchanged. |
| Same receipt ID arrives with changed generation/evidence | Persist conflict/rejection; cannot upgrade old receipt in place. | Paused if no other sufficient evidence. |
| Wrong enrollment, journal, issuer, boot or supervisor instance | Reject as target/provenance mismatch; do not silently widen authority. | Paused for original unresolved writer. |
| Local journal is lost or rolled back | New journal incarnation; old work retains uncertainty; reconcile via independently sufficient evidence. | Paused until old scope is accounted. |
| Kill lacks permission, forced stop times out, or observed writer survives | Durable remaining/unknown receipt with capability/error evidence. | Paused. |
| Host reboot is authentically and specifically proven | May settle only former local process execution under an accepted reboot-evidence profile. | Still gated by checkpoint/effects and fresh admission. |
| Grant expires or newer assignment fence exists | Stops future admissions; does not prove old processes or issued provider requests stopped. | Paused if required obligations remain. |
| Exact old scope stopped; Git/cloud request outcome unknown | Settle only local writer; retain the independent effect obligation and reconcile the same effect. | Paused where effect accounting is required. |
| Checkpoint verifies but scope remains unknown | Preserve verified artifacts without advertising a safe replacement. | Paused. |

## Sharp successor, conditional on #9 evidence

If #9 establishes a usable supervised profile, the immediate missing trust decision is **how Execution authenticates an enrolled runner's scope binding and stop/checkpoint receipts across journal replacement, reconnect and revocation**. This is already an explicit ADR 0004 prerequisite and should remain separate from supervisor mechanics. It is sharp only if the selected profile/issuer can be named concretely. If empirical supervision remains blocked, do not expand into an enrollment protocol merely to advance the map; the next decision should instead name the exact missing Linux capability/authority boundary needed to validate that profile.
