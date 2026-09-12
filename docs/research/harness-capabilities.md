# Existing harness capabilities

Research date: **2026-09-12**. Supports Wayfinder decision **#2**, the boundary between the service and customer-operated execution. This is documentation research and local interface inspection, not a working integration or a compatibility certification.

## Principal finding

The project owner has resolved the execution boundary: users install the Agents Assemble CLI on their own machines or servers; it starts a daemon and tunnel and invokes their already installed, already authenticated Codex, Claude Code or other supported harness. Those harnesses use the user's existing accounts and may call their model providers directly. Agents Assemble neither implements an agent loop nor proxies inference or model credentials, and requires no service-side model authentication.

Documented control interfaces differ: Codex App Server, Claude Agent SDK, and OpenCode HTTP/SDK. These are adapter candidates whose compatibility with the required existing-installation and native-login path remains untested. A terminal is an optional view onto a session; parsing terminal text should not define execution state.

The earlier distinction between local harness execution and local model inference is **resolved by that clarification**: direct provider calls are allowed. Codex and OpenCode also document local-model providers, while Claude's documented deployment options use Anthropic or cloud providers. The product does not require on-device model weights. [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference), [OpenCode providers](https://opencode.ai/docs/providers/), [Claude deployment options](https://code.claude.com/docs/en/third-party-integrations).

## Verified capability comparison

“Documented” means present in a fetched primary source; it does not mean tested end to end. Codex observations also include installed CLI **0.153.4** and its generated experimental TypeScript protocol.

| Capability | Codex | Claude Code / Agent SDK | OpenCode |
| --- | --- | --- | --- |
| Structured start and control | App Server JSON-RPC: `thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`. | TypeScript `query()`; streaming input supports queued messages and interruption. | `opencode serve`; HTTP session create, prompt, asynchronous prompt and abort. |
| Output and lifecycle | Thread/turn/item notifications and deltas; `codex exec --json` offers JSONL for batch runs. | Async message stream; `includePartialMessages` enables incremental output. | `/event` and `/global/event` SSE; session/message endpoints provide snapshots. |
| Approvals | Server requests for commands, file changes and permissions. | `canUseTool` callback and permission policies. | Documented permission-response endpoint. |
| Human questions | `item/tool/requestUserInput` and MCP elicitation; question API is experimental. | `AskUserQuestion` reaches `canUseTool`; currently unavailable inside Agent-tool subagents. | Reviewed server/SDK overview pages do not establish a question contract. Validate against the pinned runtime's schema before promising support. |
| Resume | `thread/resume`, `thread/fork`; CLI resume/fork. Session persistence belongs to Codex. | Session ID resume/fork; external `SessionStore` is documented. | Continue a session ID; CLI continue/fork and export/import commands. |
| Terminal attachment | CLI `--remote` connects its TUI to App Server. | Native Remote Control connects local sessions to Claude's own web/mobile surfaces. Third-party live terminal attachment is not established by these docs. | `opencode attach <url>` connects TUI to an existing server; accepts session ID. |
| Model and effort | Model discovery reports supported efforts; per-turn overrides. | Model and effort options; model-dependent support. | Provider/model selection; provider-specific variants and reasoning options. |
| Context controls | Configured context-window size and auto-compaction threshold. | Model-limited context and automatic compaction; effort is separate from thinking. | Provider/model options and local-server settings; no universal context-size guarantee. |

Sources by harness: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference); [Claude streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output), [approvals and questions](https://code.claude.com/docs/en/agent-sdk/user-input), [sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop), [Remote Control](https://code.claude.com/docs/en/remote-control); [OpenCode server](https://opencode.ai/docs/server/), [CLI](https://opencode.ai/docs/cli/), [models](https://opencode.ai/docs/models/), [providers](https://opencode.ai/docs/providers/).

## Limits that affect the boundary

- **Codex transport maturity:** official documentation calls App Server and WebSocket transport experimental and unsupported for production workloads. Use a pinned adapter with explicit acceptance experiments before committing to production support. Local CLI availability alone does not establish support maturity. [App Server](https://learn.chatgpt.com/docs/app-server).
- **Claude's native remote service is not a generic transport:** it uses Claude's own surfaces, requires an eligible subscription and the Anthropic API endpoint, and excludes custom base URLs/cloud-provider configurations. It is inspiration, not an interchangeable Agents Assemble connection. [Remote Control](https://code.claude.com/docs/en/remote-control).
- **Transcript recovery is conditional:** Claude `SessionStore` can move transcripts between machines, but mirroring is best-effort and can drop failed batches. Its file-checkpoint backups are not mirrored. A restored transcript does not reconstruct a worktree, running process, local tools or secrets. [External session storage](https://code.claude.com/docs/en/agent-sdk/session-storage). The latter reconstruction conclusion is an architectural inference.
- **Tuning is not portable by name:** “high effort” and a context token limit require harness/model validation. A configured limit cannot enlarge a model's actual capacity. Record requested settings, effective settings and unsupported capabilities separately. [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference), [Claude agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop), [OpenCode models](https://opencode.ai/docs/models/). The recording policy is a recommendation.

## HumanLayer: useful precedent, limited evidence

HumanLayer's current product page describes local and remote daemons, bring-your-own compute/harness, shared tasks and versioned artifacts with human comments. Its public development guide documents a local daemon, socket, database and CLI launch path. This supports the product analogy; it does **not** establish a reusable public tunnel protocol, delivery guarantees or exact machine-to-machine session migration. [HumanLayer product](https://www.humanlayer.dev/), [public development guide](https://github.com/humanlayer/humanlayer/blob/main/DEVELOPMENT.md).

## Recommendations and experiments

These are proposed consequences for decision #2, not additional resolved architecture decisions:

1. Keep the service's work state, document revisions, human requests and Git checkpoints authoritative. Treat a harness session ID as an adapter-owned recovery hint. Recover business progress using a new session plus persisted context when native resume is unavailable.
2. Have the customer daemon advertise harness/version/model capabilities. Unsupported requested settings must fail validation or require an explicit fallback policy. Do not silently downgrade a human approval or question into terminal prose.
3. Connect the customer daemon outward to the chosen Agents Assemble host. Keep harness APIs private to that daemon. Transport authentication, leases, replay and fencing belong to Agents Assemble; these harness interfaces do not supply an end-to-end distributed execution guarantee.
4. Before a production commitment, test one pinned harness on each intended OS: start/stream/interrupt; answer and reject native approvals/questions; daemon restart during a pending question; network loss/reconnect; duplicate command delivery; TUI attachment during orchestration; native resume with changed paths; and reconstruction from a Git checkpoint on another machine.
5. Install the CLI and start its daemon under the intended OS user identity, including the planned background-service mode. Verify that it discovers and invokes the existing harness installation and uses the user's native login for main turns, compaction and subagents without separate model API keys, copying tokens or service-side model authentication. Exercise expired login and native reauthentication; an unavailable login must produce an actionable local-authentication state. This compatibility is untested.

Local checks performed: `codex --version`, `codex --help`, `codex app-server --help`, `codex exec --help`, `codex remote-control --help`, and `codex app-server generate-ts --experimental` into a temporary directory. No model run, harness daemon, tunnel or application code was started or added.
