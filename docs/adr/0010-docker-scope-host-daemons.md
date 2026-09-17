# Docker for marketing, portal, API, and Postgres only; daemons run on host

Daemon execution needs host access to pre-installed `codex`/`claude` CLIs, so containerising it breaks the core value. Marketing, portal, API, and Postgres ship as containers; daemon and connector CLI run on the host via Bun.

## Consequences

- `Dockerfile`s exist for `apps/*` only; `packages/daemon` and `packages/connector-cli` ship as Bun-run TypeScript CLIs with CI typecheck/test, no runtime image.
