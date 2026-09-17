# Daemons dial out over WebSocket; portal never dials daemons directly

Daemons hold a long-lived outbound WebSocket to the Factory API (works behind NAT/firewalls). The portal talks to the API only; the API routes workflow commands to the right daemon and accepts execution facts. The Factory CLI bootstraps this via device authorization and token auth.

## Consequences

- API must multiplex authenticated daemon sockets and route workflow command/fact frames by daemon id.
- Direct portal-to-daemon HTTP is explicitly a non-goal for v0.
