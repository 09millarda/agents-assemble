# Shared harness conversation conformance experiment

Date: 2026-09-12 · Decision [#13](https://github.com/09millarda/agents-assemble/issues/13) · [ADR 0009](../architecture/0009-shared-harness-conversation.md)

## Verdict and archive

Select an Execution-owned ordered input ledger, exclusive one-use native dispatch claims, exact-turn steering, conservative unknown-delivery recovery and a separately gated interrupt/redirect path. Codex client message IDs do not supply deduplication in the observed version. Native acceptance does not establish execution of an instruction, and interruption does not establish stopped writers.

[Disposable source, complete fixture snapshots, sanitized native evidence, independent review and offline lab](https://github.com/09millarda/agents-assemble/tree/4c02a0c/experiments/shared-conversation) are archived at `4c02a0c` on `codex/prototype-shared-conversation`. Only planning records enter main. The archive's manifest hashes the retained files; generated installed-interface excerpts have a separate version/hash record.

## Evidence paths

| Path | Result | What it establishes |
| --- | --- | --- |
| Actual native ephemeral flow | Ten labeled observations; no script failure. | Concurrent outstanding input RPCs, duplicate acceptance, active/terminal target rejection, interruption and explicit subsequent-turn output. Ephemeral history is unavailable. |
| Actual native persistent flow | Nine labeled observations plus read/restart/resume/archive records; no script failure. | Duplicate and changed input under one client ID, start-while-active behavior, old-turn control rejection and retained user history after restart. |
| Native archive audit | 20 checks, zero failures; no further inference. | Internal consistency of retained duplicate items, target errors, readback and owned App Server exits. |
| Durable fixture | 29 scenarios, 86 checks, zero failures on repaired source. | Separate journal commits, two-sender order, identity conflicts, uncertainty, process death, replay, bounded record retention and independent stop/recovery gates. |
| Independent adversarial fixture review | Ten final scenarios, 36 assertions, zero failures. | Repairs for repeat/concurrent dispatch, interrupt barriers/capacity, numeric output replay and stale receipt behavior. |
| Offline lab browser review | Lost-ack and interruption walkthroughs plus native evidence selection inspected. | Illustrative state presentation only; no production UI or workload qualification. |

These counts must not be combined into a native or production certification. The native script's labeled observations are not all independent fault scenarios. One ephemeral label describes withholding a received reply from a hypothetical caller; it is explicitly not an actual native network fault.

## Native method and observations

Both flows used installed `codex-cli 0.153.4`, App Server stdio JSON-RPC and the existing native ChatGPT login on Linux. The probes passed an allow-list of ordinary OS environment variables and never read or copied account files, provider API keys or host/session tokens. Model and effort were omitted; effective runtime settings are retained with the evidence and are not selected product defaults.

Fresh temporary workspaces received only synthetic conversation text and bounded Python sleep/print commands. The first flow requested workspace-write with tool network disabled and checked effective permissions. The persistent flow used read-only/no tool network. Persistent native history was archived through the API after inspection. All three owned App Server instances exited with code zero. These exits are cleanup facts, not a proof of complete writer coverage; this experiment does not repeat #9's descendant/containment audit.

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) describes active-turn steering, interruption and item/history lifecycle. The freshly generated installed types supply the version-specific request fields, including `expectedTurnId`, `clientUserMessageId` and the start-while-active comment. Native observations, rather than documentation alone, determine this verdict.

The persistent flow produced the following concrete result:

| Submission | Native outcome | Retained user item |
| --- | --- | --- |
| Alice / client ID X / ALPHA | Accepted into turn 1 | Distinct item 4, `clientId: X` |
| Bob / client ID Y / BETA | Accepted into turn 1 | Distinct item 5, `clientId: Y` |
| Alice / client ID X / ALPHA again | Accepted into turn 1 | Distinct item 6, `clientId: X` |
| Alice / client ID X / CHANGED | Accepted into turn 1 | Distinct item 7, `clientId: X` |
| Carol / `turn/start` while turn 1 active | Returned turn 1 | Distinct item 8 in turn 1 |

Thus client ID X correlated three occurrences rather than preventing repetition or changed-content reuse. Application deduplication must precede native dispatch. A response returning the turn ID only proves native acceptance at that boundary, not that the model obeyed the message.

Old-turn steering and old-turn interruption returned `-32600` while a subsequent turn was active. Correct interruption returned success and the turn was interrupted. The ephemeral flow also rejected steering after terminal state and produced the requested synthetic `REDIRECT_OK` output after an explicit new start. That controlled continuation does not qualify arbitrary same-session redirect: pending accepted input may not yet have become visible, and writer/effect obligations remain separate.

Persistent readback after App Server restart preserved all observed user item identities, client IDs and text. It added a command-execution item absent from the immediate post-interrupt read. Resume returned the same retained representation as the post-restart read. This is a completed-session restart observation, not native streaming reconnection or a durable replay-offset guarantee. Ephemeral `includeTurns` reads failed explicitly.

The first ephemeral capture mistakenly read `clientUserMessageId` from user items rather than `clientId`, producing null metadata. Its original script is retained as `probe-v1.py`; those null fields establish no native capability fact. The separately executed persistent flow uses the corrected projection and supports all client-ID conclusions. Only synthetic user/assistant text, item metadata and delta byte counts are retained; reasoning bodies, tool-output bodies, account PII and raw stderr are omitted. Native IDs in errors are consistently aliased. This archive is not a complete raw native transcript.

## Durable fixture and fault boundaries

The service, daemon and modeled native effect recorder have separate SQLite WAL databases with `synchronous=FULL`. This choice isolates local persistence and does not replace ADR 0003's PostgreSQL selection. Authorization, native invocation and scope state are controlled fixtures; no production TLS, identity provider or real model call occurs in these scenarios.

Five actual worker-death cases use an observed stopped barrier followed by SIGKILL, reopen and reconciliation:

| Death boundary | Recovery state | Dispatch consequence |
| --- | --- | --- |
| After daemon receipt, before intent | Received | One fresh dispatch remains possible after revalidation. |
| After intent, before native call | Unknown | No resend, even though the fixture knows no call happened. |
| After modeled native acceptance, before receipt | Unknown | No resend; the native effect count stays one. |
| After durable native receipt | Accepted | Replay receipt without another call. |
| After service acceptance, before acknowledgment | Accepted | Replay existing verdict without another call. |

Other cases exercise actual concurrent journal commits, reordered transport of two senders, mismatched organization/run/attempt/generation/journal/thread/turn, revoke-before-dispatch, revision pause, predecessor/successor routing, definite rejection, output conflict/gap/epoch, expired replay and reader revocation. Each scenario retains its complete resulting service/daemon/modeled-native state.

Independent review demonstrated six defects in the initial model despite its original scenario set passing: repeated in-flight sends, concurrent duplicate dispatch, missing interrupt order barriers, continuation after accepted interrupt, stop blocked by ordinary queue capacity, and incorrect/unbounded output replay. The final model acquires a fresh one-use dispatch claim, keeps an interrupt gate, reserves stop capacity, retains three output records and sorts cursor envelopes numerically. It also prevents stale daemon snapshots from regressing accepted/rejected service verdicts. Original source, failing review observations and repaired evidence are all retained.

## Limits and interpretation

The fixture's authorization gate is a controlled synchronous read before dispatch. Revocation after that gate can coexist with an already admitted native call; it does not prove atomic production revocation. Production requires ADR 0006's bounded grants and explicit effective cutoff. Authenticated output event binding, current multi-user identity, protected daemon/observer authority and malicious same-user interference are not implemented here.

Output retention is bounded by record count in this fixture. Byte quotas, captured-output overflow, real snapshots, retention tombstone policy, live browser fan-out, redaction, item-delta/snapshot projection and native reconnect gaps are specified in ADR 0009 but not implemented or qualified. The fixture checks only its reduced event identity/journal boundary, not the full authenticated production source tuple.

Native acceptance followed by actual crash-time lost response, active streaming reconnection, exact ongoing-session reattachment, injected failure of native history persistence and integration with the production service/daemon are unproved. The separate durable fault model establishes the conservative fallback when native delivery is uncertain. No latency/throughput target, full interpreter, replacement admission, complete writer stop, deployment approval or release readiness is certified.

This resolves the bounded contract decision #13. Remaining integrated implementation/qualification stays in the map's unspecified work; #11's protected observer investigation remains independent. No speculative child tickets were created.
