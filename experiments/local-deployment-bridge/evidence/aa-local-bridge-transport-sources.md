# Local bridge transport: primary-source findings

Checked 2026-09-13. Research only; no tunnel started or cloud mutation performed by this researcher.

## Verified transport facts

Cloudflare Quick Tunnels provide a free, random public `trycloudflare.com` URL forwarding to a localhost HTTP server. No Cloudflare account/domain onboarding is required for this quick-tunnel path: the documented command is `cloudflared tunnel --url http://localhost:8080`, and the implementation obtains disposable credentials from the quick-tunnel service. They are for testing/development, offer no uptime/SLA guarantee, allow at most 200 simultaneous in-flight requests (excess returns 429), and do not support SSE. A `.cloudflared/config.yaml` can interfere with quick-tunnel startup. [Official Quick Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), [versioned quick-tunnel implementation](https://github.com/cloudflare/cloudflared/blob/2026.9.1/cmd/cloudflared/tunnel/quick_tunnel.go).

Cloudflare's official downloads page points to the Cloudflare-maintained GitHub releases for Linux amd64. Latest release observed was **2026.9.1**, published 2026-09-11. The release body checksum and GitHub release-asset digest agree for the standalone Linux amd64 binary:

```text
URL: https://github.com/cloudflare/cloudflared/releases/download/2026.9.1/cloudflared-linux-amd64
Size: 39838488 bytes
SHA256: 03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc
```

Use the pinned URL and verify the downloaded file before execution. This research verified published metadata, not downloaded binary bytes. [Official downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/), [2026.9.1 release and checksums](https://github.com/cloudflare/cloudflared/releases/tag/2026.9.1), [official release API](https://api.github.com/repos/cloudflare/cloudflared/releases/tags/2026.9.1).

## Recommendation for this experiment

Expose only a purpose-built gateway bound to `127.0.0.1`, with explicit claim/status routes and all other routes rejected. Both routes should authenticate a real GitHub OIDC bearer token against the trusted issuer/JWKS, exact audience, repository and owner IDs, workflow revision/path, ref/event, and persisted dispatch/run assignment. The random URL is public routing, not authorization; Cloudflare Tunnel does not replace the application's GitHub verifier. Keep PostgreSQL, local administration, filesystem serving and AWS credentials outside the HTTP interface. The workflow submits only a stored effect identifier and digest; the controller obtains its operation from owner state. These are application-boundary recommendations, not built-in Quick Tunnel guarantees. GitHub documents explicit trust validation for custom OIDC deployments. [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc).

Use quick authenticated polling of status rather than holding one HTTP request open throughout CloudFormation work. Treat tunnel interruptions and HTTP timeouts as unknown acknowledgements; recover using the durable effect/dispatch identity. Do not create a fresh deployment merely because transport failed. Avoid bearer/header logging and keep the tunnel's environment free of AWS credentials. The Cloudflare network proxies the request and is part of the transport trust boundary; this does not demonstrate a direct end-to-end private link from GitHub to the laptop. Stop the temporary tunnel after the live run and retain sanitized evidence separately.

This replaces a temporary EC2 host for the transport experiment. It does not make the laptop a continuously available service or remove the need to prove authenticated claim-to-provider execution, provider uncertainty recovery and bounded automatic restoration.
