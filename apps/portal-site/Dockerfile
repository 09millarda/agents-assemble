FROM node:24-alpine AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/portal-site ./apps/portal-site
COPY packages/shared-domain ./packages/shared-domain
COPY packages/workflow ./packages/workflow
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @factory/shared-domain build && pnpm --filter @factory/workflow build
FROM oven/bun:1 AS runtime
WORKDIR /app
COPY --from=dependencies /app /app
WORKDIR /app/apps/portal-site
EXPOSE 3000
CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
