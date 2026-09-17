# Durable workflow coordination through one Node DBOS coordinator

Status: Accepted. Supersedes [ADR-0023](0023-ui-defined-global-flows.md).

The Factory API remains on Bun and owns the authenticated outbound daemon WebSockets. A separate Node coordinator using pinned DBOS core owns every run transition, with pure rules and contracts in `@factory/workflow`. Both processes use the same Postgres database: the API submits portable JSON to documented DBOS SQL enqueue/message functions through Drizzle, so Bun never loads DBOS.

Commands are persisted before socket delivery. Stable command, execution, and message identities join the coordinator’s state with the daemon’s durable execution journal. Reconnection resends identities for reconciliation; interrupted effects with unknown outcomes wait for a user decision. Human waits release harness execution capacity. Cancellation stops subsequent dispatch, sends a durable cancellation request, and preserves run records and worktrees.

A database advisory lease admits one coordinator. Its contract version cannot change while affected runs are nonterminal. Operators must drain or explicitly cancel those runs before an incompatible upgrade. The old client-reported progression and fan-out interpreter are removed, and retired scaffolding runs are archived without becoming executing workflows.

Losing the lease stops the process. Application-store outages retry the same persisted message without consuming activity executions or loop passes; failures in DBOS persistence also stop the process for restart recovery. A deterministic interpreter failure records a recovery decision so the user can still cancel the run.

DBOS checkpoints and application writes are separate transactions. Each application transition atomically writes state, documents, commands, and notifications and records the input identity. If a process dies after that transaction but before a DBOS checkpoint, replay reads the already-applied input and does not repeat effects. See [verified integration research](../research/workflow-durable-execution.md).
