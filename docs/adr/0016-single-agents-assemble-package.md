# Single agents-assemble package (merge daemon library into the CLI)

The split `packages/daemon` library plus `packages/connector-cli` CLI existed only
because `factory-daemon` / `factory-connect` were once separate binaries (ADR-0014
replaced them with one `agents-assemble` CLI, but left the two packages behind with
a workspace dependency between them). The pairing-code domain (`pairing_codes`
table, `canEstablishDaemonConnection`, `isPairingCodeValid`) was superseded by the
device flow in the same change.

## Decision

- One host package: `packages/agents-assemble` (`@factory/agents-assemble`) owns
  `features/device-auth`, `features/daemon-connection`, and
  `features/workflow-execution`. The CLI imports siblings via relative paths; the
  `@factory/daemon` workspace dependency is gone.
- Alpha deletion in the same change: `packages/daemon` and
  `packages/connector-cli` are removed, the pairing-code predicates and their
  tests are removed from `shared-domain`, and `pairing_codes` is removed from
  `drizzle/0000_init.sql` (`0002` keeps its idempotent `DROP TABLE IF EXISTS`).

## Consequences

- `agents-assemble auth login|logout|status` and `agents-assemble daemon start`
  are the only host surface. No `factory-daemon` shim, no pairing-code path.
- ADRs 0008–0010 stay as history; living docs (`AGENTS.md`, `README.md`)
  describe the single package.
