# Native-writer supervision experiment

Date: 2026-09-12 · Decision [#9](https://github.com/09millarda/agents-assemble/issues/9) · Map [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Verdict

**Select a retained delegated cgroup-v2 payload inside a per-invocation systemd user service as the bounded Linux reference mechanism.** Require exact scope/activation identity, closed launch admission, actual terminal scope evidence and independently sufficient writer coverage. [ADR 0005](../architecture/0005-native-writer-supervision.md) records the protocol and explicit pause conditions.

Four actual Codex probes and six harmless Linux process scenarios establish the observed behavior. The independent native audit passes **69 archive assertions** plus **14 original-workspace integrity assertions**, without new inference. The durable stop/admission model and native archive review are separate evidence paths. They do not compose into a production daemon, authenticated receipt issuer, security sandbox or integrated takeover certification.

The strongest negative result is that a user-service cgroup can report `populated 0` while a writer launched through the same user's manager in a sibling service continues. Therefore automatic takeover on unrestricted customer tooling remains paused unless all such work is separately accounted for or an enforced profile establishes complete scope.

## Archive and reproduction

The [disposable source, complete observations, reviews and single-file browser lab](https://github.com/09millarda/agents-assemble/tree/d0ddb2c/experiments/writer-supervision) are archived separately at `d0ddb2c` on `codex/prototype-writer-supervision`. The [native audit](https://github.com/09millarda/agents-assemble/blob/d0ddb2c/experiments/writer-supervision/native/review-results.md) and [independent protocol review](https://github.com/09millarda/agents-assemble/blob/d0ddb2c/experiments/writer-supervision/protocol/review-admission-results.md) retain their findings and limitations. Only decision/research records belong on main.

From that experiment directory:

```sh
python3 fixtures/throwaway_fixture.py
python3 protocol/probe.py suite --output /tmp/writer-stop-protocol-rerun.json
python3 native/review-native.py
python3 protocol/review-admission.py
python3 build-viewer.py
```

The fixtures use the standard library and an existing systemd user manager, create uniquely named transient units and bounded local writers, and clean only their recorded units/processes. Native reproduction is opt-in through the archive's native README and uses the existing account's ordinary inference allowance. The standalone `writer-supervision-lab.html` includes illustrative walkthroughs excluded from empirical counts. Loopback browser inspection verified parent-exit refusal, unknown-effect pause, old-receipt isolation and the final 90-case protocol payload. Direct file-URL navigation was unavailable in the in-app browser; its URL policy was respected. Local Markdown links and whitespace checks passed.

## Actual native supervision

All four probes use the same installed Codex CLI `0.153.4`, App Server stdio JSON-RPC, Linux `7.0.0-31-generic`, systemd `259.5-0ubuntu3.4` and current OS user. Each initializes a fresh ephemeral thread through the existing managed ChatGPT login. The child environment is an allow-list without provider API keys or Codex host/session tokens; native account files are never read or copied by the probes. Native model/effort are omitted; the runtime reports `gpt-6-astra` and `ultra`. These are observed settings, not product defaults.

The native tool receives one exact local command running a harmless, self-bounded 60-second heartbeat writer. A command-start event, started marker and heartbeat establish the injection boundary. The marker's sandbox PID `2` is correlated with its unique host Python process through `NSpid`. Evidence retains boot/start-time/namespace, unit activation, cgroup inode and process observations. Only sanitized lifecycle metadata is archived; no native prompts, reasoning, tool output, account PII, credentials or raw stderr are retained.

| Probe | Observed result |
| --- | --- |
| Plain user service, native interruption | `turn/interrupt` returned and the native terminal status was `interrupted`; the writer pidfd was still nonterminal at the next snapshot. Whole-unit stop ended the identified writer. |
| Plain user service, App Server SIGKILL | One second after App Server death the writer remained alive and its heartbeat grew from 2 to 23 bytes. Whole-unit stop ended it. |
| Retained delegated payload, App Server SIGKILL | The native writer again survived and continued appending. Killing only the owned delegated payload produced actual `populated 0` on the same inode, with the original service activation and trusted supervisor still alive. A scoped receipt file was written/synced before outer cleanup. |
| Retained delegated payload, native interruption | A separate run exercised graceful interruption followed by payload termination, retained empty-state observation and receipt-before-cleanup ordering. |

The raw status `observed_scoped_stop` is a coarse experiment label: plain runs establish known-process exit, while the delegated runs add payload-only terminal evidence. Every native run starts exactly one turn and performs no replay. Whole-service cleanup leaves the known writer exited, its heartbeat stable and its natural completion marker absent. The two plain-service runs lose their original cgroup before a post-stop read: held event descriptors return `ENODEV`. That is recorded as unavailable terminal sampling, not fabricated into an empty reading. The retained-payload runs avoid this race by keeping their observer outside the terminated payload.

The prototype uses `Delegate=yes` only for that retained variant. Its trusted shim creates a fresh payload cgroup, moves the native child there before `exec`, launches only once and remains outside after native exit. It directly kills only its delegated child; it stops the manager-owned outer service through `systemctl`. The shim does not enable resource controllers. This is a process-supervision experiment, not an audit of all native tool capabilities or the global systemd configuration.

Installed protocol types, including `TurnInterruptParams`, were inspected before invocation. The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) supplies interface context. Observations from the pinned binary, rather than current documentation alone, establish this compatibility result.

## Linux process and manager evidence

The independent OS fixture passes **six empirical scenarios**:

1. A writer changes session and double-forks, then survives termination of its original process group.
2. Killing the service main process leaves its detached writer and the same `ExitType=cgroup` service activation alive.
3. Writers ignoring TERM are ended by the service's bounded TERM-to-KILL stop.
4. Killing the submitting fixture daemon leaves the service, activation and cgroup identity available to a replacement observer.
5. Explicit restart preserves the unit name but changes `InvocationID`, despite `Restart=no`.
6. A writer asks the same user manager to launch an explicitly owned sibling service; that sibling keeps writing after the original scope stops.

Five instrumented service stops take **0.799–0.967 seconds** in this run. Sampling the held `cgroup.events` descriptor every 2 ms captures `populated 1 → 0 → ENODEV` in three cases, and `1 → ENODEV` without a sampled zero in two. The sibling-escape case captures actual outer emptiness while the sibling heartbeat continues. This directly separates observed subtree emptiness from coverage of all possible writers.

Three additional **modeled guard examples** illustrate identity mismatch, observed outside-scope work and missing manager capability. They are not three more OS experiments; no host capability was deliberately disabled. Final cleanup verifies no live process among 13 recorded birth identities and all five final-run owned units inactive/not-found.

An initial fixture run failed because a relative output path was interpreted under the user service's working directory. It is retained as a harness precondition failure; the source was corrected to resolve the path before launch, and the exact owned unit/output was cleaned up. It is excluded from successful counts.

## Durable stop and admission evidence

The disposable model passes **90 scenarios**, including **five actual barrier-observed SIGKILL/reopen/reconciliation cases**. Service, daemon and supervisor fixture keep separate SQLite WAL journals with `synchronous=FULL`. Each killed worker reaches an observed boundary and stops itself before the controller sends SIGKILL, preventing the intended failure from racing a later commit.

The death boundaries are before stop-gate commit, after that commit, after supervisor stop but before receipt, after receipt commit, and after service acceptance but before daemon acknowledgment. Recovery retains or reacquires the original exact scope observation, replays the same durable receipts/verdicts, never launches another invocation and leaves the separate unknown effect outstanding. The supervisor is modeled; these are database/process failure results, not native-supervisor restart results.

Other scenarios cover all 25 target-binding field mismatches, seven supervisor-instance substitutions, trusted-principal versus payload-issuer distinction, stale requests/receipts, exact replay and payload conflicts, lost/replaced journals, incomplete scope/capability, launch gates, retained rejected verdicts, independent external effects and bounded new admission. Checkpoint checks compare the exact allowed manifest and actual artifact bytes; Git commit identities and verifier authority are fixture inputs, not a new real-Git proof. ADR 0004 retains the separate Git evidence.

An independent targeted review passes **13 additional assertions** against the final source. It exposed and verified repairs for a reachable stale-predecessor admission, replacement runner/profile eligibility, and concurrent receipt-ID allocation. Recovery now binds the current occurrence writer/generation, checks all relevant writer/effect obligations in that modeled occurrence, and preserves immutable concurrent receipt allocation. A distinct nonconflicting occurrence is modeled separately; shared-workspace/resource conflict scheduling remains outside this experiment.

The positive admission case requires sufficient old-writer evidence, accounted effects, the exact verified manifest, an eligible recovery class and a fresh generation/attempt within allowance. A late old receipt settles only its own obligation; an intentionally seeded replacement remains active. That seeded adversarial case demonstrates isolation, not an authorized takeover path.

## Evidence boundaries

The native receipt is a local fixture observation, not an Execution stop envelope: it has no authenticated enrollment, assignment generation or production journal binding. Its file was fsynced before cleanup, but the parent directory was not; this run establishes recorded ordering and readable artifacts, not power-loss durability. The durable protocol model supplies separate process-death/replay evidence and still does not certify storage hardware or a production journal.

Held pidfds protect observations after acquisition. The prototype acquires them after reading a numeric PID and has a possible acquisition race; the archive audit checks the recorded writer's matching process start ticks and namespace across snapshots for these runs. Production acquisition/reconciliation must eliminate ambiguity rather than treating an old numeric PID as a handle. Payload inode equality is meaningful within the observed retained lifetime, not after deletion or reboot.

Native source hashes identify the executed top-level probes; the independent audit records helper hashes at review time and checks preserved writer bytes. It cannot retrospectively establish execution-time helper provenance from a hash that was not captured then. Retain this distinction when reproducing.

The model's trusted issuer/verification fixture, actual native stop probes and Linux process fixtures are separate. Full daemon restart with native retained scope, durable observer recovery, enrollment/tunnel authentication, receipt signing/revocation, malicious same-UID tools, cgroup/controller isolation, remote executors, unknown provider effects, real PR publication, power failure, journal rollback, reboot attestation and other harnesses/OSs remain unproved.

The next sharp decision, [#10](https://github.com/09millarda/agents-assemble/issues/10), specifies enrolled-runner authority and authenticated grant/receipt provenance for this named observer profile. Stronger isolation and tool coverage remain required before certifying automatic takeover for unrestricted native work. First-release scope and license/parity remain the separate owner decisions #4 and #5.
