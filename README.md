# Agent Software Factory

Apache-2.0 open source. Paid hosted version is a deployment of this repo, not a fork.

- `apps/marketing-site` — Astro.
- `apps/portal-site` — React + shadcn. Workflows, projects, activity editors, documents, conversations, and browser notifications.
- `apps/api` — Hono + Postgres (Drizzle). Daemons dial out over WebSocket; portal talks via API.
- `apps/coordinator` — Node DBOS; durable workflow progression and Web Push delivery.
- `packages/workflow` — workflow contracts, pure rules, and use cases.
- `packages/cli` — `cli` CLI: `auth login|logout|status` (device flow) + `daemon start`. Holds the outbound daemon WebSocket and executes workflow activities through pinned local Codex app-server, isolated Git worktrees, and GitHub CLI publication.
- `packages/shared-domain` — shared kernel (types, Result, predicates).

See `AGENTS.md`, `CONTEXT.md`, `docs/adr/`.

See [durable workflow setup and cutover](docs/operations/workflow-execution.md) and [integration research](docs/research/workflow-durable-execution.md).
