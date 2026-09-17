# Postgres with Drizzle ORM from day one

Single Hono Factory API persists the daemon registry (daemons, connections, pairing codes, tokens) in Postgres via Drizzle ORM instead of starting in-memory. Pays the Docker Compose cost once to avoid a stateful migration later.

## Consequences

- `apps/api` owns `drizzle.config.ts` and `src/db/schema.ts`; migrations are checked in.
- Local dev requires `docker compose up postgres` (or full compose).
