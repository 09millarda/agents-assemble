# Contributing

Agents Assemble uses Apache-2.0 for project-owned software, documentation and starter materials. Hosted and self-hosted installations share the same source and core features. Contributions require the Developer Certificate of Origin 1.1; there is no separate CLA or copyright assignment.

Read [CONTEXT.md](CONTEXT.md) and the relevant accepted architecture decisions before changing ownership, approval, recovery or publication behavior. Work in a branch. Keep domain code independent of Hono, PostgreSQL and provider SDKs; adapters implement explicit ports. Every JSON route must register its Zod ingress/egress schema and generated OpenAPI contract. Use shadcn components for UI changes.

Run `docker compose up -d --wait`, `npm ci`, `npm run check`, and `npm run test:browser`. Tests use a separate PostgreSQL database. External provider and native-account qualifications are opt-in and must never be described as passed merely because local conformance passed. Prefer tests through HTTP, CLI, WebSocket and provider ports; do not add test-only state mutation seams.

Sign off each contribution with `git commit -s` after reviewing [DCO 1.1](https://developercertificate.org/). The sign-off must identify the contributor who can make the certification. Automated tools must not impersonate another person's certification. Preserve third-party notices and regenerate the dependency inventory after changing dependencies.

A pull request should explain the changed behavior and verification, plus any remaining qualification limits. Exact artifacts, approvals and unknown-effect records are append-only; operational repair must use typed commands instead of deleting history.
