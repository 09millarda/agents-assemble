# Single WebSocketServer gateway: Bun delivers upgrades to the first listener only

Two `ws` WebSocketServers sharing one `node:http` server (one per path) silently starves the second. The active gateway therefore owns the daemon WebSocket path (`/ws/daemon`) and dispatches it from one `SocketGatewayAdapter`; there is no portal prompt socket.

## Consequences

- Never add a second `WebSocketServer` on the same HTTP server; add a branch in the gateway instead.
- The daemon path remains the only supported WebSocket upgrade path.
