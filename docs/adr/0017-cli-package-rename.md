# Rename agents-assemble package to cli

`packages/agents-assemble` (`@factory/agents-assemble`, binary `agents-assemble`) was verbose and diverged from the ubiquitous term. The host CLI is the Factory CLI.

## Decision

- One host package: `packages/cli` (`@factory/cli`) owns `features/device-auth/`, `features/daemon-connection/`, and `features/workflow-execution/`.
- Single binary `cli`: `cli auth login|logout|status` and `cli daemon start`.
- Ubiquitous term is Factory CLI (`CONTEXT.md`); historical ADRs 0014/0016 keep the old name as record.
- No backwards-compatibility alias: alpha stage, old import path and binary name are removed outright.
