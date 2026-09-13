# Agents Assemble

A durable control plane for collaborative coding agents. Playbooks, specifications, approvals, native runner attempts, pull requests, and deployment receipts retain their exact versions and history. The UI uses React and shadcn; JSON APIs use shared Zod validation and generated OpenAPI at `/api/v1/openapi.json`.

## Local development

Requires Linux, Node.js 24, npm, Docker Compose, Git, and OpenSSL. A runner additionally needs the qualified native Codex baseline and its existing native account login; see [runner installation](apps/runner/README.md).

```sh
npm ci --ignore-scripts
cp .env.example .env
docker compose up -d --wait
npm run db:migrate
npm run bootstrap
npm run dev
```

Open [the application](http://localhost:5173). Bootstrap asks for a local account and organization. Its password input is hidden. Noninteractive setup accepts `AA_ADMIN_EMAIL`, `AA_ADMIN_NAME`, `AA_ORGANIZATION`, and `AA_ADMIN_PASSWORD` through the environment. Do not commit credentials.

Configure a project, register a GitHub repository, set exact check commands, create a runtime and environment profile, and enroll a runner. Native model credentials remain with the runner's existing Codex installation. An unavailable capability or unresolved outcome blocks work with a visible cause.

## Container installation

The same API, worker, database contracts, and UI run in the self-hosted profile. WorkOS, billing, and the public registry are optional.

```sh
docker compose -f compose.yaml -f compose.control-plane.yaml build
docker compose -f compose.yaml -f compose.control-plane.yaml up -d --wait
docker compose -f compose.yaml -f compose.control-plane.yaml run --rm api node dist/bootstrap.mjs
```

Open [the installed application](http://localhost:3001). The browser API binds to loopback by default; expose it through your HTTPS reverse proxy and set `WEB_ORIGIN` to that exact origin. Runner enrollment and polling use the separate mTLS listener on port 3443. Set `RUNNER_HOSTNAME` before initial CA/server identity generation. Preserve the `control_plane_state` and `postgres_data` volumes.

The example database passwords are for an isolated local installation. Set `POSTGRES_PASSWORD` and `APP_DATABASE_PASSWORD` before first initialization. Migrations run with the database owner; API and worker use the non-inheriting `aa_control_plane` role and enter one context role per transaction. Account bootstrap uses application permissions and does not migrate schemas.

## Hosted identity and GitHub

Local identity is the default. To enable the WorkOS adapter, set all of `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, and `WORKOS_REDIRECT_URI`. Configure that redirect URI to your application's origin and callback route. AuthKit login uses PKCE and a browser-held login proof, while organization authorization remains in Access. Provider session revocation is checked on authenticated requests. Provision the initial administrator with bootstrap; invitations establish further organization membership.

With WorkOS configured, public package publication requires an installation invitation by default. The installation operator sets `INVITED_PUBLISHER_ORGANIZATIONS` to a comma-separated list of organization UUIDs; Access retains each policy revision. Restart API and worker together after changing it. Organization administrators cannot grant themselves this installation-level invitation. Self-hosted operators can require the same policy with `PUBLICATION_POLICY=invitation`, or select `local` explicitly.

`GITHUB_TOKEN` belongs to the Integrations adapter. `GITHUB_WEBHOOK_SECRET` must contain at least 32 characters. Configure a repository route and exact immutable staging/production workflow profiles through the APIs/UI. The generated API document describes signed GitHub ingress and provider OIDC claims. The deployment reference is distributed under `examples/reference-delivery`; it does not deploy Agents Assemble itself.

## Verification and operation

```sh
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
npm run inventory
```

Browser acceptance starts its own preview on port 5173. Run the API and worker separately with `npm run api` and `npm run worker`, leave that preview port free, and set `AA_BROWSER_EMAIL` and `AA_BROWSER_PASSWORD` to an existing local account. Without those credentials, authenticated browser cases are explicitly skipped.

Tests use `agents_assemble_test`, separate from development data. The process-restart conformance test creates and removes its own PostgreSQL Docker container. It kills its own API/worker processes and restarts that database. Provider protocol fixtures are explicitly distinguished from live GitHub/AWS qualification. See [implementation and qualification evidence](docs/implementation/issue-20.md) and [operator procedures](docs/operations.md).

The project is Apache-2.0. [Third-party notices](THIRD_PARTY_NOTICES.md), the [locked dependency inventory](docs/distribution/dependencies.json), and [contribution requirements](CONTRIBUTING.md) accompany distribution. There are no subscription or seat caps in the core product.

Standalone CLI, web, and control-plane builds include full upstream license texts, a package-to-license index, and the source dependency inventory. The reference Lambda ZIP includes its project and bundled dependency licenses. Notice generation runs offline and rejects missing or mismatched dependency terms.

The [architecture and retained research index](docs/architecture/index.md) preserves the accepted decisions and their original experiments.
