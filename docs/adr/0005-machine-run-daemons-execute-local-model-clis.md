# Machine-run daemons execute workflow activities locally

Daemons run on the user's own machine and execute workflow activities through the pre-installed, pre-configured Codex app-server rather than calling model APIs directly from the hosted backend. This keeps credentials and execution on the user's hardware and makes the factory runnable self-hosted.

## Consequences

- Workflow execution stays behind a daemon-side execution port and adapter, with the daemon owning local model credentials and process access.
- Portal↔daemon communication must assume daemons are behind NAT/firewalls — the daemon dials out to the Factory API and keeps the authenticated channel open.
