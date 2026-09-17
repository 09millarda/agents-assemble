# Monorepo with pnpm workspaces, Bun runtime, TypeScript everywhere

We build one open-source monorepo (`apps/*`, `packages/*`) in TypeScript, run with Bun, orchestrated with pnpm workspaces, so every surface (portal, API, daemons, CLIs) shares domain types and hexagonal conventions without version drift.
