# Run and verify durable workflows

The API runs on Bun. The coordinator runs on Node 24 with DBOS core 4.27.6. Both require the **same** `DATABASE_URL`; DBOS stores its own schema alongside the application tables. The daemon continues to connect outbound to the API. Workflow model execution requires locally installed Codex CLI **0.154.0**; unavailable or unsupported models/efforts are rejected before dispatch.

The daemon is verified on Linux and requires Git, a POSIX shell, and util-linux `flock`. Its process lock prevents two daemons from executing against the same durable journal. Missing lock support or a lost lock stops startup or execution with an explicit error. GitHub publication additionally requires the authenticated `gh` CLI and working Git push credentials.

## Local setup

1. Install workspace dependencies with `pnpm install` and build with `pnpm build`.
2. Start Postgres with `docker compose up -d postgres`.
3. Follow the cutover below when replacing an existing database; on an empty development database, run `pnpm --filter @factory/db db:migrate`.
4. Start the Node coordinator (`pnpm --filter @factory/coordinator dev`), Bun API (`pnpm --filter @factory/api dev`), and portal (`pnpm --filter @factory/portal-site dev`). Start an authenticated host daemon with `cli daemon start`.
5. Create the editable feature-building starter in Workflows. Select a connected daemon’s available Codex model/effort, enable the workflow on a project, and start it with an optional prompt. No prompt starts the requirements interview.

## Browser push enrollment

Generate VAPID keys once with `pnpm --filter @factory/coordinator exec web-push generate-vapid-keys`. Store the public/private pair and a `mailto:` contact in environment variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Configure the API with the same public key and the Node coordinator with all three values. Never rotate these keys automatically on restart.

Open the portal in a supported desktop browser over HTTPS (localhost is allowed for development). Use its explicit notification enrollment control. Each browser stores its own management token; enrollment and run binding require that token. The subscription can be replaced without changing browser identity. Permission denial and delivery status remain visible in the portal.

Push subscriptions are delivered by the Node coordinator independently of run progression. Failed delivery cannot recreate a PR or reverse completed work. A notification uses a stable identity across retries; expired subscriptions are deactivated. Closing all portal tabs is supported while the browser/OS push service remains available. Force-quitting the browser, unavailable devices, or revoked permission can prevent delivery. Mobile push is outside first-release acceptance.

## Existing database cutover

Stop old API instances and any other writers of the retired workflow schema before applying the migration. Preserve an operational database backup according to the deployment’s normal backup procedure.

Migration `0005` acquires exclusive locks on retired definition, library, run, and project enablement tables; archives every row to immutable `retired_workflow_archives`; verifies row counts and checksums; and replaces the active schema in one transaction. It retains independent projects, daemon credentials, and device authorizations. Archived scaffolding runs are historical records and are never enqueued as workflows. The migration ledger prevents retired table creation files from being replayed later. Archive and Context Document rows have database immutability guards.

Migration `0007` resets any pre-cutover definitions that were already stored in the current `workflows` table to an empty editable graph. Retired activities and actions are not converted.

The migration tests use a dedicated test database, never the configured application database. Applying the migration to an existing deployment is an operational cutover, separate from running the code tests.

## Coordinator upgrades and recovery

One coordinator owns a database advisory lease. A second process is refused. `COORDINATOR_VERSION` is the persisted execution contract; change it for incompatible interpreter behavior only after affected runs finish or are explicitly cancelled. The lease prevents an incompatible version from starting while nonterminal runs remain. The executor identity stays stable for DBOS restart recovery.

Daemon receipts do not establish successful execution. On reconnect, unfinished command identities are redelivered. A durable daemon journal replays known results or requests reconciliation for ambiguous effects. The user can retry or cancel; a recovery attempt remains separate from a loop pass. A human wait preserves its session and transcript without reserving a harness slot.

Run worktrees are retained after completion or cancellation. Setup commands have persisted logs and execute in the run worktree. No environment files are copied automatically. Publication resolves its destination before model work, commits through normal hooks, and uses non-forced push. The reviewed tree must still match at publication; changed content requires another review and approval. A lost response is reconciled against the remote branch and existing PR.

## Verification

Routine checks use boundary substitutes for harness, GitHub, and push services. Use `pnpm exec turbo run test typecheck build` for workspace checks and `docker compose build api coordinator portal-site` for changed services.

The coordinator integration tests require a migrated, isolated Postgres database whose name contains `test`. Set `FACTORY_INTEGRATION_DATABASE_URL` and run `pnpm --filter @factory/coordinator test`; these launch real Bun HTTP/WebSocket and Node DBOS processes. The tests cover SQL messaging, hard coordinator restart, persisted human waits, frozen settings, exact document revisions, and duplicate answers/approvals. The schema-cutover tests require `WORKFLOW_TEST_DATABASE_URL`; read their setup before running because they create and replace fixture tables in that isolated database.

Real external acceptance is recorded separately in [integration research](../research/workflow-durable-execution.md). A stub push test or service-worker unit test is not proof that a closed browser page receives an OS notification. That check requires an enrolled supported desktop browser and observation of delivery and click-through. Real PR smoke tests must use an explicitly selected disposable repository and branch; normal test runs never publish to GitHub.

See the [verification record](workflow-verification.md) for completed checks and outstanding external acceptance.
