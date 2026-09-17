# Docker containers, cloud-agnostic deployment, single open-source codebase with paid hosted build

Every service ships as a Docker container with env-based config so it deploys anywhere (local, VPS, K8s) and the paid hosted version is a deployment of this same repo, not a fork. This keeps self-hosting and commercial hosting aligned.

## Consequences

- No host-specific assumptions in code; secrets via environment only.
- Hosted vs self-hosted differences via deployment config / feature flags, never private code.
