FROM node:24-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/coordinator ./apps/coordinator
COPY packages/workflow ./packages/workflow
COPY packages/db ./packages/db
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @factory/workflow build && pnpm --filter @factory/db build && pnpm --filter @factory/coordinator build
WORKDIR /app/apps/coordinator
EXPOSE 3003
CMD ["node", "--import", "tsx", "dist/index.js"]
