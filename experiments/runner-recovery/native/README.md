# Native Codex reference probe

Date: 2026-09-12. Decision scope: Agents Assemble #8; disposable compatibility evidence, not production adapter certification.

## Result

**The installed Codex can perform bounded work through its existing managed ChatGPT login and can recover task progress in a fresh native thread from verified Git and artifact inputs. Killing its app-server does not prove the local tool process stopped.**

| Boundary | Observed result |
| --- | --- |
| Interface | `codex-cli 0.153.4`, `codex app-server --stdio`, structured newline-delimited JSON-RPC, Linux x86_64. CLI help labels the interface experimental. |
| Native identity | `account/read` returned `type: chatgpt` with `requiresOpenaiAuth: true`. Same existing OS user. The child environment allow-list contains no API keys or host/session/auth-token variables. Authentication files were never read or copied by this probe. |
| Settings | Model and effort were omitted. Thread start reported `gpt-6-astra`, provider `openai`, effort `ultra`. These are the interface's effective configuration fields, not independent per-token model telemetry. |
| Permissions | Requested workspace-write, network off, approvals never, ephemeral thread. Effective `workspaceWrite` policy matched; `/tmp` and TMPDIR implicit writes were excluded. The probe refuses to invoke a write turn if the effective policy is broader. No global configuration was changed. |
| Initial real native turn | Baseline had 2 failing assertions among 3 tests. Lifecycle showed acknowledged turn, command start/completion, file change and completed turn. Native changed only `arithmetic.py`; all 3 original tests passed. |
| Pinned checkpoint | Original failing commit `a1a255f481307d3a3b0e7487c91117d4b7ac048f`; working checkpoint `a6ec3042758d957b856acbe1b28e50aa0a055586`. Both retained by explicit tags in an archived Git bundle. No network Git remote. |
| Fresh recovery | A separate clone was checked out at the exact working checkpoint. Bundle, artifact and source file hashes were checked; original failing commit remained reachable. A distinct ephemeral thread received the manifest and bounded continuation, with no prior native transcript copied/imported. Native added iterable summation while preserving recovered addition; all 7 tests passed. |
| Actual native crash | After `turn/start` acknowledgment, structured command start, and a verified local started marker, a real SIGKILL ended the app-server with exit -9. The operation had not finished. One second later 2 identified descendants remained alive, including the sleeping Python command. No native terminal-turn event was received. |
| Lookup after crash | A new app-server returned `thread not loaded` for `thread/read` and `no rollout found` for `thread/resume` of the lost ephemeral thread. Exactly one native turn was started for this attempt; no automatic retry followed. Verdict remained `pause-dispatch-unknown`. |
| Cleanup | The crash probe identified exact Linux descendants by host PID and process start time; the operation's sandbox PID was correlated using `NSpid`. It then terminated only those identified live descendants, with zero remaining. This is bounded local cleanup evidence, not proof concerning escaped descendants or remote effects. |

`results/results.json` and the lifecycle JSONL files preserve the observed successful run. `kill-results/` preserves the actual crash and failed read/resume lookup. Traces retain method names, event/item types, status, exit codes, and local aliases; they exclude native IDs, account PII, prompts, reasoning, command output, credentials and raw stderr. Native RPC payloads were processed only in memory. Native threads requested ephemeral storage. Normal account-managed inference still contacts the configured model provider; no tracker, PR, or other external publication was performed by the probes.

## Verification and corrections

The original recovery run began before a reviewer identified that `git diff --name-only` cannot prove an untracked test was preserved. The final source explicitly checks both test file hashes and the exact allowed untracked set. An independent post-run check of the original retained workspace verified the recovery test equals the original fixture literal, and original tests and manifest retain their expected hashes. It also reconstructed both commits from the archived bundle and applied the archived recovery diff: original defect reproduced, checkpoint 3 tests passed, recovered code 7 tests passed. That 25-assertion audit is recorded one directory above in `review-native-check.py` and `review-native-check-results.json`. No additional inference was used for this integrity audit.

The first crash attempt compared a sandbox PID directly with host PIDs. That precondition correctly failed before SIGKILL; the parent then exited normally. Evidence is retained in `kill-precondition-pid-namespace/`, not counted as native crash success. The corrected probe uses a unique owned Python descendant's final `NSpid`, emits a startup marker, and confirms the finish marker is absent before injection. The successful run contains these explicit preconditions.

## Reproduce

Requires the installed, normally authenticated native Codex account, Git and Python 3. No API key is requested. Running the native probes consumes normal native-account inference usage. They create disposable repositories under `/tmp`, commit fixture baselines/checkpoints there, and never commit in the product repository or push to an external remote.

```sh
python3 probe.py --account-only --output /tmp/aa-native-readiness
python3 probe.py --output /tmp/aa-native-rerun
python3 kill_boundary.py
```

`kill_boundary.py` writes `kill-results/` beside its source; preserve a recorded run before rerunning it. Both scripts terminate their owned native app-server processes in cleanup. The crash command is a bounded local 30-second sleep between marker writes. Do not transfer native auth files or saved native session state as part of reproduction.

To regenerate local schema evidence:

```sh
codex --version
codex app-server --help
codex app-server generate-ts --out schema --experimental
```

`schema-evidence.json` records hashes for the eight relevant generated types. The full generated schema is ignored because it is large and reproducible. Source fields inspected include account/read, thread start response effective permissions/model, ephemeral threads, turn lifecycle, optional `clientUserMessageId`, and thread/resume.

## Contract limits

- This is one executable/version, one Linux host and the same interactive OS identity. Different harnesses, native plans, service users, containers, operating systems, deployment identities, headless reauthentication and expired-account recovery remain untested.
- Fresh task reconstruction is demonstrated on a separate local clone and thread. It does not prove exact machine migration, native transcript portability, persisted-session resume, or continuation of an interrupted tool operation.
- `clientUserMessageId` exists in the installed schema. Its deduplication or lost-response lookup semantics were not tested. A JSON-RPC request ID or completed-session lookup does not establish safe invocation replay.
- Manifest `invocationGrant` is trusted fixture text. This native probe does not prove service admission, grant authenticity, assignment generations, durable daemon journaling, tunnel reconnection, expiry enforcement or fencing. Those belong to the separate protocol/conformance experiment.
- The native crash shows why parent exit and failed session lookup cannot establish stopped writers or absence of effects. An unknown accepted invocation must stay unresolved until the adapter obtains sufficient evidence; a server fence cannot physically stop a retained local process.
- Hash checks establish equality against this trusted fixture manifest, not production artifact provenance or signatures. Real repository permissions, reachability retention, LFS, submodules, toolchains and remote publication receipts remain outside this probe.

The installed schema was inspected first. Official documentation confirms the initialize/start/turn notification lifecycle and managed-account inspection surface: [Codex App Server](https://learn.chatgpt.com/docs/app-server). Documentation supplies interface context; the recorded executable observations establish this bounded compatibility result.
