FROM oven/bun:1 AS runtime
WORKDIR /app
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/marketing-site ./apps/marketing-site
WORKDIR /app/apps/marketing-site
RUN bun install
EXPOSE 3002
CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3002"]
