# ADR-0022: Daemon deregistration as soft delete with force-disconnect and fresh identity

## Status

Accepted.

## Context

Daemons are long-lived per-machine identities. Removing a row outright would lose audit history and risk token reuse, while leaving a live socket open would let a deregistered daemon keep executing workflow work. The portal and CLI need one explicit removal path.

## Decision

- Soft delete only: `POST /v1/daemons/{daemonId}/deregister` keeps the row with `deregistered` status (no `DELETE` verb in v0 per API standards). Default reads (`listDaemons`, `listKnownDaemons`) exclude deregistered rows; there is no include-flag or restore path in v1.
- Force-disconnect: the command closes the live daemon socket (`4403 daemon deregistered`) through a `DaemonDisconnectionPort`.
- Fresh identity only: `verifyDaemonToken` permanently rejects deregistered rows, `updateDaemonOnHello` never revives them, and `issueDaemonCredentials` mints a fresh id when the requested id is deregistered. Repeats return `410 DAEMON_ALREADY_DEREGISTERED`; unknown ids return `404 DAEMON_NOT_FOUND`.
- Surfaces: portal daemon list with status, refresh, filtering, search, and deregistration; CLI `daemon delete [daemonId]` defaults to the stored identity, calls the endpoint, then clears local credentials only on self-delete. `auth logout` stays local-only. Open deregistration in v0; proper auth later.

## Consequences

- Deregistered ids are never resurrected; operators re-login for a new identity.
- The committed `openapi.json` carries the new route; `POST` (not `DELETE`) keeps the v0 method ban.
