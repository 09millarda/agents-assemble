# ADR-0019: Factory DB package owns Postgres primitives

## Status

Accepted. Supersedes the ADR-0009 consequence that `apps/api` owns `drizzle.config.ts` and `src/db/schema.ts`.

## Context

The daemon registry and device authorizations are the only Postgres state in v0, but the Drizzle tables, connection helper, and SQL migrations lived inside `apps/api`. Any future consumer of the same tables would duplicate the schema or reach into the API tree. The API's hexagonal shape should depend on persistence primitives, not own them.

## Decision

- New workspace `packages/db` (`@factory/db`) is the single owner of Postgres persistence primitives: Drizzle tables (`daemons`, `deviceAuthorizations`), `createDatabaseConnection(connectionString)` with the single-shared-pool rule unchanged, the shared `Database` type, the `eq` operator re-export, and the migrate runner (`runDatabaseMigrations` / `resolveMigrationsDir`).
- `packages/db` owns `drizzle.config.ts`, `drizzle/*.sql`, and the `drizzle-orm` / `postgres` / `drizzle-kit` deps (plus their explicit `@types/*` deps per pnpm isolation).
- `apps/api` keeps its hexagonal shape — domain ports, `Drizzle*` adapters, and containers stay put — and imports primitives from `@factory/db` via `workspace:*`. `db:migrate` / `db:generate` in `@factory/api` are thin passthroughs to the package. `apps/api/src/db/`, `apps/api/drizzle/`, and compiled `drizzle.config.*` are deleted outright (alpha rule: no compat shims, no dual paths).
- `apps/api/Dockerfile` copies `packages/db` alongside `packages/shared-domain`. `docker-compose.yml`, `DATABASE_URL`, and the Postgres service are unchanged.

## Consequences

- One schema source of truth; future consumers import `@factory/db` instead of copying tables.
- `apps/api` holds no direct `drizzle-orm` / `postgres` deps; persistence changes land in `packages/db` with the API adapting at its outbound ports.
- "Models" in this ADR means Drizzle schema tables, not domain entities; no `CONTEXT.md` glossary change.
