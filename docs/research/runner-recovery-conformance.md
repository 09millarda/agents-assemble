# Customer-runner recovery experiment

Date: 2026-09-12 · Decision [#8](https://github.com/09millarda/agents-assemble/issues/8) · Map [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Verdict

**Accept the durable local receipt, launch-uncertainty, stable result replay and verified fresh-session reconstruction contract in [ADR 0004](../architecture/0004-runner-assignment-and-checkpoint-recovery.md).** All **26 final daemon scenarios pass**, with **25 additional independent daemon assertions** and a separate **25-assertion native archive/integrity audit**. These counts describe separate evidence paths, not one integrated production test suite.

The reference native probe demonstrates that **Codex CLI 0.153.4, App Server over stdio, can use the existing ChatGPT login under the current Linux user identity and reconstruct useful work in a fresh session from verified Git/artifact inputs**. It also demonstrates that **killing App Server does not establish that its tool process stopped**. Recovery therefore preserves an explicit unknown-outcome pause; automatic takeover requires a stronger supervision contract.

## Archive and reproduction

The [disposable source, full evidence and standalone browser lab](https://github.com/09millarda/agents-assemble/tree/16bd3cf/experiments/runner-recovery) are archived at `16bd3cf` on `codex/prototype-runner-recovery`, separately from main. The archive includes exact [daemon snapshots](https://github.com/09millarda/agents-assemble/blob/16bd3cf/experiments/runner-recovery/daemon/evidence.json), [native compatibility evidence](https://github.com/09millarda/agents-assemble/blob/16bd3cf/experiments/runner-recovery/native/README.md), [actual native crash result](https://github.com/09millarda/agents-assemble/blob/16bd3cf/experiments/runner-recovery/native/kill-results/results.json), both independent review scripts/results and the self-contained Git bundle. Final daemon source SHA-256 is `4e7634ac5e8f16bdec73c4eebf9d3252229614015be1568da7c7b449948e08f6`, matching both daemon evidence and independent review.

From the archived experiment directory, run `python3 daemon/probe.py suite --output /tmp/runner-daemon-rerun.json`, `python3 review-daemon-check.py` and `python3 review-native-check.py`. The native archive checker replays without inference; its additional original-workspace audit is available only while the recorded temporary workspace remains present. Actual native inference/crash reproduction requires the installed normally authenticated harness and follows the archive's native README. No native credentials or transcripts are distributed with the experiment.

The single HTML file opens directly without a server and embeds the recorded JSON. Browser inspection verified the uncertain-launch and lost-result-reply walkthroughs, final 26-case evidence selection and the native unknown-outcome verdict. Its illustrative model is not included in the empirical scenario count. Documentation link/whitespace checks passed; no prototype code is merged into main.

## Native account and checkpoint evidence

The child environment admits a small set of ordinary OS variables and excludes provider API keys and host/session tokens. The probe does not read, extract or copy account credentials; the installed harness accesses its normal native login. The structured `account/read` response is reduced to account type `chatgpt` and authentication-required state; account identifiers and credentials are excluded from retained evidence. The installed interface's generated protocol schemas and hashes are recorded, alongside [official App Server documentation](https://learn.chatgpt.com/docs/app-server).

Both model and effort are omitted from requests. The effective settings reported by the installed runtime are `gpt-6-astra`, OpenAI provider and `ultra`; these are observations, not launch defaults. The runtime reports the requested workspace-write sandbox, no tool network access, no broad `/tmp` write allowance, approval policy `never`, and ephemeral threads. Native model-provider communication still occurs through the harness under ADR 0001. This setting report is not a security audit of every tool capability.

The first native session receives a harmless Python addition bug in a disposable Git repository. The original three tests have two failing assertions; the native change repairs only the arithmetic module and all three tests pass. The fixture commits that working state while retaining the distinct original failing baseline. A complete Git bundle pins both commits; a separate clone without Git object alternates verifies bundle hash, baseline ancestry, commit/file content and the exact recovery-manifest hash.

A second ephemeral App Server session receives this verified working checkout, explicit baseline/context references and a bounded continuation to add `sum_many`. The continuation changes only the arithmetic module and all seven tests pass. No native transcript is exported or copied. Native resume is not used for this positive recovery path. The manifest's new grant is a controlled fixture reference; the separate daemon experiment exercises bounded service admission. This is not an integrated real-service grant claim.

An independent archive reconstruction and original-workspace integrity audit passes **25 assertions** without additional inference. It rebuilds the failing baseline and repaired checkpoint from the archived bundle, applies the recorded continuation patch, reruns the original seven tests, verifies test/manifest preservation and confirms the exact declared untracked files. The probe was strengthened to hash test files before and after future native runs; the independent audit establishes their integrity in the recorded run.

## Actual native crash boundary

The crash probe begins one ephemeral turn containing a harmless local operation: write a start marker, sleep, then write a finish marker. It observes `turn/start` acknowledged as in progress, a structured command-start event and the local start marker before sending SIGKILL to App Server.

The parent exits with `-9`. One second later **two identified descendants remain alive, including the sleeping tool operation**. The finish marker is absent and no terminal turn event was received. A new App Server cannot read the lost ephemeral thread and cannot resume a rollout that was never persisted. No second `turn/start` is issued. The recorded verdict is a dispatch/outcome-unknown recovery pause. The probe then cleans up its exact observed Linux descendants and records zero remaining within that known set.

The first attempt at this probe failed a precondition: the sandbox's marker reported namespace PID 2, which was incorrectly compared with host PIDs. No kill occurred in that attempt, and the owned operation finished normally. Its evidence is retained separately. The corrected probe correlates an owned Python descendant using Linux `NSpid`; this is a correction to the experiment, not evidence of a harness failure. Enumerating known descendants still does not certify containment of arbitrary detached or escaped tools.

## Durable daemon fault evidence

The suite uses Python 3.14.4, Git 2.53.0 and SQLite 3.46.1 through the standard library, with separate WAL journals and `synchronous=FULL`. It runs actual loopback HTTP disconnects and real SIGKILL barriers. Each worker stops at an observed barrier until the controller continues or kills it, so the intended fault cannot race a later durable write. Its service is a controlled fixture, not ADR 0003's production PostgreSQL. Its native child is a harmless counter/Git-writing process, not Codex. Complete snapshots expose local receipt, invocation, result and service-verdict state.

| Evidence group | Observed result |
| --- | --- |
| Twelve daemon death boundaries | Death before/after receipt, launch intent, spawn, child completion, checkpoint, result save and service acceptance preserves the recorded obligations. An uncertain launch pauses without re-invocation; durable checkpoint/results replay without launching again. |
| Four actual loopback disconnect windows | Lost connections before/after receipt and result commits reconcile the original command/result and produce one fixture launch. |
| Result expiry | A newly arriving expired result is recorded as rejected; an exact already accepted result returns its original verdict after expiry. Independent review also changes the current generation before replay. |
| Concurrent and conflicting work | A second worker cannot acquire the runner lock. Duplicate command IDs replay; changed payloads, another command ID for the same attempt and an unadmitted attempt do not launch again. |
| Expiry, cancellation and journal loss | No new launch under expired/cancelled/unadmitted work. Replacing the journal incarnation pauses. A real fixture child remains alive and completes its local write after grant expiry, demonstrating the limit of service fencing. |
| Stop scope | Cancellation first observes the child still alive; pidfd observes termination of that exact fixture process. Stop envelopes bind its process instance/PID and attempt/generation. Stale and mismatched evidence cannot mark the replacement stopped. This is trusted fixture provenance, not a production stop-attestation adapter. |
| Checkpoint and fresh admission | Independent plain-Git checkout verifies the original baseline, working checkpoint and pinned content. Wrong repository/baseline/input, artifact tamper/scope and missing objects block verification. Recovery binds the verified manifest and input digest to a fresh declared class/attempt/generation; exact replay charges once and exhausted allowance blocks another admission. |

The independent daemon review adds 25 adversarial assertions against the final source. It checks stable accepted-result replay across expiry and replacement, rejected new stale results, immutable payloads, a consumer clone without alternates, permanent rejection verdicts, exact verification/input binding, fresh admission accounting and process/generation stop scope. These are separate from the 26 scenario count.

Review repaired several load-bearing gaps before the final suite: a runner lock prevents simultaneous workers from both launching; recovery admission compares the exact verified manifest/input instead of trusting a boolean; accepted and rejected verdicts remain stable on replay; stop receipts bind the recorded process identity; and receipt/launch acceptance checks the actual issued grant and current attempt. The fixture still trusts the origin of verification and stop observations. The observed contents and hashes establish equality within this fixture, not authenticated production provenance.

## Limits and next decision

The real native probe and durable daemon fixture are separate experiments. They support a minimum architectural contract, not an end-to-end production daemon/tunnel/PostgreSQL/harness certification. The native test used the current Linux OS user and configured account; it does not prove background-service identity, expired-login repair, another account, harness, version, OS or physical machine.

Native persistent-session resume, pending human approvals/questions, terminal attachment, tool isolation, process-tree containment, production journal migration/retention, disk corruption, clock suspension/skew, enrollment, tunnel authentication, canonical grant signing, environment/secret rotation and real Git/PR receipt authenticity remain unproved. Plain Git text-file recovery does not certify LFS, submodules, untracked build inputs, remote retention or hermetic toolchains.

The next sharp technical question is [#9, native writer supervision and stopped-writer evidence before automatic takeover](https://github.com/09millarda/agents-assemble/issues/9). Killing the parent is demonstrably insufficient in the observed configuration. Keep uncertainty explicit until the selected supervisor/adapter can account for the actual writer scope. Live integration publication and transport provenance remain future decisions, separately from first-release scope (#4) and licensing (#5).
