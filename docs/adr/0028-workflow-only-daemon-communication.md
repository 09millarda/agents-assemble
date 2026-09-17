# Workflow-only daemon communication

## Status

Accepted.

## Decision

The authenticated daemon WebSocket is a workflow execution channel. The daemon
hello advertises the workflow capabilities implemented by that daemon. The
Factory API sends persisted workflow commands and accepts execution facts; the
daemon connection remains outbound from the user's machine.

The portal has no direct daemon prompt socket. Daemon management is handled by
the Factory API's REST surface, while workflow runs and their conversations are
represented by the workflow API and portal activity views. Legacy `chat.*`
frames are ignored by the daemon adapter and never produce chat frames.

The alpha codebase removes the legacy portal chat, portal socket registry,
ordinary model-process execution path, chat contracts, and their tests. The
Codex app-server adapter remains the only daemon-side harness execution path.

## Consequences

- `/ws/daemon` is the only supported WebSocket path.
- Workflow command and fact identities remain durable and replayable across
  daemon reconnects.
- Old portal chat URLs, socket clients, and ordinary prompt execution are not
  supported.
