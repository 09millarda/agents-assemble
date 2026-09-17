# Device-flow auth replaces pairing codes (superset of ADR-0008 bootstrap)

Supersedes the pairing-code bootstrap in ADR-0008. The outbound-WebSocket connection model is unchanged: daemons still dial out and hold the socket, the portal still talks to the Factory API only.

## Decision

Authenticate machines with an RFC 8628-style device flow instead of pasted pairing codes:

- `POST /device/authorizations` returns `device_code` + `user_code` + `verification_uri` + `expires_in`/`interval`.
- The CLI prints `Go to <verification_uri> and enter code <user_code>`, opens the browser with a printed-URL fallback, and polls `POST /device/token`.
- Polling honors `interval`, `slow_down` backoff, and the `expires_in` deadline; maps `authorization_pending` / `access_denied` / `expired_token` to typed errors.
- The portal `/device` page approves/denies via `POST /device/approve` / `POST /device/deny`. No user login in v0; approval alone authorizes the daemon.
- Approval mints `daemonId` + `authToken` once; the first poll consumes them (single-use). `daemon.hello` WebSocket auth is unchanged, including the `4401` close for rejected credentials, which the CLI uses to trigger an inline login.

## Rationale

Same pattern as `gh auth login`, Claude, and Stripe CLIs: no secret is ever pasted, the code the user types is short and single-purpose, and headless/CI works with `--no-browser` plus `FACTORY_API_URL`. Breaking change: old `factory-daemon` / `factory-connect` binaries and `POST /pairing-codes` + `POST /daemons/connect` are removed outright.

## Consequences

- Pending grants live in Postgres (`device_authorizations`) via Drizzle; plaintext `auth_token` is stored only until the first approving poll consumes it.
- `agents-assemble auth login|logout|status` and `agents-assemble daemon start` are the only CLI surface; `daemon start` reuses valid `~/.factory/credentials.json` or runs login inline.
- New domain predicates (`isUserCodeValid`, `canPollDeviceAuthorization`, `canApproveDeviceAuthorization`) in `shared-domain`; new `device-authorization/` features in API, CLI, and portal behind small ports.
