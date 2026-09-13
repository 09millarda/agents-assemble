# Pilot operation and recovery

Run one API and one worker for the documented local profile. PostgreSQL owns ordering, command identities, inbox receipts, immutable revisions, and outbox delivery. A browser disconnection does not cancel execution. Treat `outcome_unknown` as unresolved work rather than permission to retry it.

## Diagnose a wait

1. Read the run's manifest, holds, node occurrences, assignments, requests, and delivery effects through the UI or `/api/v1`.
2. Check Fleet for native login, exact Codex version, credential generation, journal identity, connectivity, and supported capabilities.
3. Inspect `/operations` and `/operations/{context}/messages`. These views expose scoped delivery attempts, sequence, poison status, and error causes without revealing message payloads.
4. After resolving a delivery failure, use `/operations/{context}/messages/{id}/retry` with the current attempt count, a stable idempotency key, and a reason. This retries the original immutable message; consumer deduplication prevents it from granting a second native or external effect.

Operations refreshes worker observations every 5 seconds. Each context shows the last completed worker cycle as `recent`, `stale`, or `unknown`; an observation becomes stale after 30 seconds according to database time. `unknown` means no completed cycle has been recorded. Check the worker process and its scheduler/delivery errors when observations are stale or unknown. These observations are bounded operational metadata and grant no execution authority. `/api/v1/health` checks API/database availability independently, so a healthy API does not imply an active worker.

Independent holds remain independent. Retaining an older specification revision does not clear a runner revocation, interruption, package quarantine, project suspension, or restore fence. A fresh successor starts from entry under a new admission manifest and does not inherit approvals or completed outputs.

## Backup

Install PostgreSQL 18 client tools and `tar` on the operator machine. Stop API and worker before taking the paired database/identity snapshot. Keep the database running. For Compose, stop only the `api` and `worker` services. Set `DATABASE_URL` to an owner connection and `STATE_DIRECTORY` to the matching control-plane identity directory.

```sh
npm run backup -- --quiesced --directory=/private/backups/agents-assemble-001
```

The new directory contains a custom-format PostgreSQL dump, the control-plane signing/CA identity archive, and SHA-256 checksums. It is private because it includes cryptographic keys. All document/blob content is inside the database for this installation profile. Back up customer runner journals separately in their original protected location; a control-plane snapshot is not a runner writer-stop receipt.

## Restore into a new installation

Restore never overwrites an existing database or identity directory. Set `BACKUP_DIRECTORY`, `RESTORE_DATABASE_URL` (a **new** database name with database-creation credentials), and `RESTORE_STATE_DIRECTORY` (a **new** path), then run:

```sh
npm run restore
```

The restore verifies the paired checksums, recreates context contracts, restores immutable records and ordering, and adds an explicit restore hold to every active run before any worker starts. Keep old runners disconnected while reconciling the recovered installation. Configure API/worker to the new database and restored state directory only after checking the recorded restore decision.

A snapshot may predate a successful external action. Reconcile GitHub workflow/run/attempt, PR identity, native journal, and retained writer scope against external evidence. The tool does not clear restore holds or reissue effects. An incomplete protected observation cannot authorize automatic workspace takeover. Start a separately approved delivery only after resolving uncertain earlier effects.

## Updates

Stop workers before migrating. Back up first, build the new pinned dependency image, run migrations with the owner connection, then start API and worker with the application role. Preserve the state volume; replacing the CA or session key silently breaks identity continuity. Failed migrations roll back their context DDL transaction. Do not repair failures by deleting accepted records or changing immutable digests.

Raw harness output is bounded and marked when a retention gap occurs. Structured receipts, approvals, manifests, and immutable artifacts remain available for pilot audit. Operational logs contain correlation identifiers and error classes; secrets and model credentials do not belong in them.
