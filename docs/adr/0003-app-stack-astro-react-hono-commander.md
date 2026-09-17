# App stack: Astro marketing, React portal, Hono APIs, Commander connector CLI

Marketing is Astro (static), portal is React (daemon communication UI only for now), APIs are Hono, and the connector CLI is TypeScript + Commander. Each technology maps to one deployment unit, keeping boundaries obvious.

## Considered Options

- Next.js full-stack instead of split Astro+React+Hono — rejected: couples marketing and app lifecycles and weakens the cloud-agnostic Docker-unit mapping.
