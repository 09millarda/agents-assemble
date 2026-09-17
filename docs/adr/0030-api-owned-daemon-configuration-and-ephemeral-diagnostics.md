# API-owned daemon configuration and ephemeral diagnostics

Status: Accepted.

The Factory API owns each daemon's desired configuration and sends revisioned updates over the authenticated outbound daemon WebSocket; the daemon enforces a FIFO Harness Capacity while cancellation bypasses that queue. The Portal Site receives exact raw diagnostics through a Factory API SSE stream backed only by the current in-memory Daemon Connection Session, rather than opening another WebSocket or persisting logs. This keeps portal control compatible with machines behind NAT, preserves durable workflow commands separately from best-effort diagnostics, and avoids turning sensitive raw traffic into permanent history.
