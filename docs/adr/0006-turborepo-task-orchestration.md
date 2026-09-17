# Turborepo for task orchestration over pnpm workspaces with Bun

pnpm workspaces own package linking; Turborepo owns `dev`/`build`/`test`/`lint`/`typecheck` orchestration; Bun is the runtime and script runner. Turbopack is not used directly — no Next.js app needs it (Astro static, React via Vite, Hono on Bun).

## Considered Options

- Turbopack as bundler — rejected: nothing in the stack consumes it; the ask was a Turborepo/Turbopack naming mix-up, settled in grilling Round 1.
