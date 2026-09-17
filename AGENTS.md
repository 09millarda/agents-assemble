# AGENTS.md — Agent Software Factory

Apache-2.0 open source. All code lives in this monorepo. The paid hosted deployment is built from this same code — no closed-source forks.

## Project Stage — Alpha: No Backwards Compatibility

This is an alpha application. There are no stability or backwards-compatibility guarantees for APIs, CLIs, schemas, configs, or file layouts. Breaking changes are expected and preferred over carrying legacy baggage.

- Delete, don't deprecate: remove broken, unused, or superseded code, endpoints, flags, types, and docs outright in the same change. No dead code, commented-out blocks, deprecation shims, feature-flagged old paths, or compatibility aliases.
- Never add backwards-compatibility layers, versioned fallbacks, or migration shims to preserve old behavior. Change the single current path and update all callers.
- When replacing functionality, delete the old implementation rather than running old and new side by side.

## Vision

Build and run agent-driven software workflows on user-owned machines. Machine-run daemons execute workflow activities through the configured local Codex app-server. The portal UI communicates with those daemons via the Factory API. The Factory CLI establishes the portal↔daemon connection via the device flow.

## Monorepo Layout

- `apps/marketing-site` — Astro static marketing site.
- `apps/portal-site` — React + shadcn app. Workflows, projects, activity editors, documents, conversations, browser notifications, and daemon management.
- `apps/coordinator` — Node DBOS coordinator; sole owner of durable workflow progression.
- `packages/workflow` — Shared workflow rules, contracts, ports, and use cases.
- `apps/api` — Single Hono Factory API. Daemon registry in Postgres via Drizzle ORM. Multiplexes authenticated daemon WebSockets for workflow commands and facts.
- `packages/cli` — TypeScript + Commander CLI (`cli`): `auth login|logout|status` (device flow) + `daemon start`. Holds the outbound daemon WebSocket and executes workflow activities through the local Codex app-server.
- `packages/shared-domain` — Shared kernel: daemon/connection/workflow-adjacent types, `Result` type, business predicates. No framework imports.
- `docs/adr/` — Decision records. `CONTEXT.md` — Ubiquitous language (use those terms exactly).

## Toolchain

- Language: TypeScript throughout.
- Runtime: Bun except the Node DBOS coordinator. Workspaces: pnpm workspaces. Task orchestration: Turborepo (`dev`, `build`, `test`, `lint`, `typecheck`). Turbopack is not used (see ADR-0006).
- Containers: Docker for marketing-site, portal-site, api, coordinator, postgres. The cli runs on host via Bun (see ADR-0010).
- Marketing: Astro. Portal: React + shadcn (Tailwind). APIs: Hono + Drizzle + `pg` + `ws`. CLI: Commander.
- DB: Postgres from day one, accessed only via Drizzle in `packages/db/src/` (`@factory/db`).

Connection model (see ADR-0008): daemons dial OUT over WebSocket to the Factory API and hold the socket. Portal talks to the API only. The Factory CLI bootstraps trust via the device flow. Never add direct portal→daemon HTTP in v0.

Commands:
- `pnpm install` (bun runtime: `bun install` works once bun is installed) — install all workspaces.
- `pnpm dev` / `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm typecheck` — turbo-orchestrated across workspaces.
- `docker compose up --build` — full factory (marketing, portal, api, postgres) locally.
- `docker compose up postgres` — DB only for API dev.
- `bun run db:migrate` (in `apps/api`) — apply Drizzle migrations.

## Architecture — Hexagonal (Ports & Adapters), SOLID, Feature-Based

Mandatory for `apps/api`, `apps/coordinator`, `packages/workflow`, `packages/cli`, and portal features:

- `features/<feature-name>/domain/` — Pure business rules. Entities, value objects, ports (interfaces ending in `Port`), business predicates. No I/O, no framework imports.
- `features/<feature-name>/application/` — One use case per file (e.g. `connectDaemonToFactoryApi.ts`, `executeWorkflowCommand.ts`). Depends only on domain ports.
- `features/<feature-name>/adapters/` — Inbound (Hono routes, React components, Commander commands) and outbound (WS clients, `pg`/Drizzle repos, app-server clients) implementations of ports.
- `features/<feature-name>/infrastructure/` — Composition root, config from env, DI wiring. No business logic.

Dependency rule: `domain <- application <- adapters <- infrastructure`. Domain never imports outward.

SOLID enforcement:
- Single responsibility: more than one reason to change → split the module. One file, one concept.
- Open/closed: new harness transports = new adapters, never domain edits.
- Small focused ports (`DaemonConnectionPort`, `DaemonRegistryPort`, `WorkflowExecutionPort`), never fat interfaces.
- Application depends on port interfaces; infrastructure injects concretes.

Feature layout: group by feature (`features/daemon-connection/`, `features/workflow-execution/`), never by technical layer. Shared kernel (`packages/shared-domain`) only for truly cross-feature types.

Factory API REST rules are enforceable in `apps/api/AGENTS.md` (OpenAPI-first, Zod DTOs, `/v1`, RFC 9457 errors, cursor pagination, CQS). API changes must satisfy that file.

## TypeScript Conventions

- Extensionless relative imports (from './foo', never './foo.ts') — required for emit builds.
- Cross-package imports use workspace deps (@factory/shared-domain: workspace:*), never relative paths or tsconfig path hacks.
- Explicit @types/* devDependencies per package (pnpm isolation — no phantom deps).
- One shared DB pool per process: build the registry once in the composition root and share it between routes and sockets.
- One WebSocketServer per HTTP server (see ADR-0012); route paths in the socket gateway.
- Workflow Codex execution uses the pinned bidirectional app-server stdio adapter (ADR-0026).
- When changing workflow progression, recovery, documents, approvals, or publication, read ADR-0024 through ADR-0026. The coordinator owns progression; the API submits persisted commands and facts.
- Incompatible coordinator upgrades require affected runs to finish or be explicitly cancelled. Schema cutover archives retired definitions, activities, run history, and enablement before removing their active tables.
## Readability / Naming

Code documents itself. No single-letter variables (except idiomatic indices). No raw comparisons in application logic.

- Predicates read as business questions: `canPollDeviceAuthorization(...)`, `canApproveDeviceAuthorization(...)`, `isDaemonReachable(...)`, `canDeregisterDaemon(...)`.
- Verbs first, single purpose: `runDeviceLoginFlow()`, `connectDaemonToFactoryApi()`, `executeWorkflowCommand()`.
- Adapters name the technology: `WebSocketDaemonConnectionAdapter`, `DrizzleDaemonRegistryAdapter`, `CodexAppServerAdapter`, `HonoDaemonRoutesAdapter`. Write intention-revealing code per `.agents/skills/intention-revealing-code/SKILL.md` (declarative orchestration, `canX`/`isX`/`hasX` predicates, `verbNoun` services).
- Errors are domain-typed `Result<T, DomainError>`; map to HTTP status / CLI exit codes at the adapter edge only.

## Open-Source + Paid Hosted Rules

- License: Apache-2.0 (`LICENSE`). Keep headers out of source files.
- No hosted-only features in private repos. Differences via deployment config / feature flags.
- Every containerised service has a `Dockerfile` + env-driven config. Secrets via environment only — never commit tokens, keys, or model credentials. Copy `.env.example` to `.env`.

## Test-Driven Development (Mandatory)

All production code is built red → green → refactor. No exceptions outside the list below. One vertical slice at a time (one test → one implementation → repeat), never all tests up front.

- Red first: write one failing test at the public seam before writing or changing implementation. Watch it fail.
- Green minimal: write only enough code to pass that one test. No anticipatory generality or extra behavior.
- Refactor clean: with tests green, remove duplication and sharpen naming and structure. Tests stay green throughout; if behavior must change, start a new red step.
- Test at seams only: domain predicates and use cases through their public functions with stub ports; adapters through their observable interface (HTTP shape, socket frames, CLI output). Never mock your own modules, test private methods, or assert call counts. Mock only at system boundaries: network, databases, time/randomness, filesystem, model CLIs.
- Independent expectations: expected values are known-good literals from the spec or `CONTEXT.md` terms, never recomputed the way the implementation computes them.
- Bugfixes: reproduce first with a failing regression test at the seam, then green minimal plus refactor.
- Deletion (alpha rule): when removing broken, unused, or superseded code, delete its tests in the same change. No orphan tests, no keeping tests just in case.
- Colocation: tests live beside the source as `<module>.test.ts` inside the same `features/<feature>/` layer. Shared kernel tests live in `packages/shared-domain/src/`.
- Runner: `bun test` per workspace, orchestrated by `turbo run test`. A task is not done until `turbo run test`, `typecheck`, and `build` are green for every touched workspace.

Exempt from TDD: throwaway prototypes, `.github/` workflows, generated code (`drizzle/*`, `dist/*`), static config (Dockerfiles, `tailwind.config.ts`, `components.json`), and `echo` script placeholders.

## Contribution Workflow for Agents

1. Read `CONTEXT.md` + relevant `docs/adr/` before coding.
2. Agree the seams under test, then write the failing test first (red).
3. Add/adjust code under `features/<feature>/` per the layering above (green), then refactor.
4. Keep domain pure and unit-testable without Docker/network/LLM. Push I/O to adapters behind ports.
5. Update `CONTEXT.md` on new domain terms; add `docs/adr/NNNN-<slug>.md` for hard-to-reverse choices.
6. Verify: `turbo run test` + typecheck + build for touched workspaces; `docker compose build` where Dockerfiles changed.
