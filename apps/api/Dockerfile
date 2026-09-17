FROM node:24-alpine AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/shared-domain ./packages/shared-domain
COPY packages/workflow ./packages/workflow
COPY packages/db ./packages/db
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @factory/shared-domain build && pnpm --filter @factory/workflow build && pnpm --filter @factory/db build
FROM oven/bun:1 AS runtime
WORKDIR /app
COPY --from=dependencies /app /app
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["bun", "run", "src/index.ts"]
