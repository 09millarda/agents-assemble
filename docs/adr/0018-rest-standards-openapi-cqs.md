# ADR-0018: Factory API REST Standards on OpenAPI 3.1 with CQS

## Status

Accepted.

## Context

The Factory API grew one route at a time with ad-hoc JSON shapes (`{ daemons, daemonIds }`, `{ status, error }` strings, unversioned paths). Portal and CLI callers each tolerated a different subset, and there was no machine-readable contract. We need one enforceable standard before the surface grows.

## Decision

- Single stack: Hono + `@hono/zod-openapi` generating OpenAPI 3.1, with Zod DTOs as the single source of truth for the wire.
- All v0 routes move under `/v1` in the same change (alpha delete-don't-deprecate: no compat shims). The `/v1` prefix is a deliberate override of the alpha no-versioning norm, accepted to give the portal/CLI a stable base.
- RFC baseline: RFC 9110 method/status semantics, RFC 9457 `application/problem+json` for all errors, RFC 3339 UTC dates, RFC 8288 `Link` headers, RFC 8259 JSON. Existing RFC 8628 device-flow behavior is preserved under these codes.
- Cursor pagination by default (`limit` default 20, max 100, stable `createdAt`+id ordering); offset only for tiny fixed config lists with written justification.
- Strict DTO-vs-Drizzle separation via explicit `toDomain`/`toPersistence` mappers; thin route handlers (parse → call service → map `Result`); application split into `queries/` (reads) and `commands/` (mutations) enforced by naming, folders, and review — no dispatcher library.
- `apps/api/openapi.json` is generated and committed; `pnpm build` fails on drift; `GET /v1/openapi.json` and `GET /v1/docs` serve spec and UI.
- Zod 4 (via `zod@^4` + `@hono/zod-openapi@^1.6`) rather than Zod 3, because that is what resolves against `hono@^4` today; no separate Zod migration slice.

## Consequences

- Portal and CLI move to `/v1` together with the server; old paths return `404`.
- Poll clients read HTTP statuses (`200` pending/approved, `403` denied, `410` expired, `429` backoff) instead of `{ status, error }` bodies.
- Every new route pays the DTO + spec-regeneration cost up front; drift breaks the build by design.
