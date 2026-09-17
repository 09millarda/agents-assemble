# Factory API — REST Standards

Enforceable contract for every HTTP seam in `apps/api`. Root `AGENTS.md` still applies (hexagonal layering, TDD, alpha delete-don't-deprecate). When this file and a stale example disagree, this file wins.

## Stack — One Way

- `Hono` + `@hono/zod-openapi`, served as OpenAPI 3.1. No second router, no hand-rolled validators.
- Zod DTOs are the single source of truth for the wire. Every request body, query, param, and response has a Zod schema in `features/<feature>/adapters/inbound/dto/`.
- Routes are declared with `createRoute` and served with `app.openapi(route, handler)`. If a route is not in the OpenAPI document, it does not ship.
- The committed `apps/api/openapi.json` is generated, never hand-edited. `GET /v1/openapi.json` serves it live; `GET /v1/docs` serves the UI.
- Workflow: change the DTO → change the route → `bun run openapi:generate` → commit the spec. `pnpm build` runs `openapi:check` and fails on drift.
- Operational endpoints that serve the contract itself (`GET /v1/openapi.json`, `GET /v1/docs`) are exempt from the document — listing them would recurse. `GET /health` is declared because Docker and hosted healthchecks depend on it.

## Versioning and Methods (RFC 9110)

- All routes live under `/v1`. No unversioned paths; no compat shims for deleted paths (alpha rule).
- `GET` reads and never mutates. `POST` creates or runs a command. No `PUT`/`PATCH`/`DELETE` in v0.
- `201` + `Location` on every create (`POST /v1/device/authorizations` → the grant resource). `200` on reads and commands.
- Status meanings are fixed: `400` malformed or unusable input, `401` bad daemon credentials, `403` denied grant, `404` unknown resource, `409` conflicting state, `410` gone or expired grant, `422` well-formed but semantically invalid values, `429` poll backoff. The existing RFC 8628 device flow keeps its behavior under these codes.

## Errors — RFC 9457 Only

- Every error body is `application/problem+json` with exactly `type`, `title`, `status`, `detail`, `code`, `instance`. Never `{ success, data }`, never ad-hoc `{ error }`.
- Build errors with `buildProblemDetail` (`src/infrastructure/http/problemDetails.ts`). `code` repeats the domain error code verbatim; `instance` is the request path.
- Validation failures from the OpenAPI hook return `422` with code `VALIDATION_FAILED`.

## Shapes and Encoding

- JSON is RFC 8259. Dates are RFC 3339 UTC strings (`expiresAt`), never epoch numbers on the wire.
- Single resources return bare DTO JSON (`{ daemonId }`, `{ denied: true }`).
- Collections return `{ data: T[], pagination: { nextCursor: string | null, limit: number } }`, plus an RFC 8288 `Link: <...>; rel="next"` header whenever `nextCursor` is set.

## Pagination Law

- Cursor pagination is the default. Cursors are opaque base64url tokens; clients never construct them.
- `limit` defaults to 20, max 100, enforced by the query DTO. Ordering is stable (`compareDaemonIds`, timestamp-ordered resources use `createdAt` then id).
- Offset pagination is allowed only for tiny fixed config lists, and only with the justification written in an ADR.

## DTO vs Drizzle Separation

- Postgres primitives live in `@factory/db` (`daemons`, `deviceAuthorizations`, `createDatabaseConnection`, `Database`, `eq`). Adapters import them from `@factory/db`; never add `drizzle-orm`/`postgres` deps back to `@factory/api`.
- Drizzle rows never leave the outbound adapter. Map with explicit `toDomain`/`toPersistence` functions (`toDaemonSummary`, `toDeviceAuthorizationRecord`) and unit-test the mapper without a database.
- Inbound routes map domain results to Zod DTOs at the edge. `authTokenHash` and other persistence details never appear in a DTO.

## Thin Controllers, CQS Use Cases

- Route handlers orchestrate only: parse → call one query or command → map `Result`. Max ~10 lines. No business rules in handlers.
- Application splits into `application/queries/` (pure reads: `list*`, `get*`, `poll*`) and `application/commands/` (mutations returning `Result`: `request*`, `approve*`, `deny*`). CQS is enforced by folder plus naming plus review, not by a dispatcher library.

## Intention-Revealing Code

- Follow `.agents/skills/intention-revealing-code/SKILL.md`: declarative orchestration, small `canX`/`isX`/`hasX` predicates, `verbNoun` services, no raw comparisons at call sites.
