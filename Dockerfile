FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/runner/package.json apps/runner/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/platform/package.json packages/platform/package.json
COPY packages/catalog/package.json packages/catalog/package.json
COPY packages/collaboration/package.json packages/collaboration/package.json
COPY packages/community/package.json packages/community/package.json
COPY packages/execution/package.json packages/execution/package.json
COPY packages/runner/package.json packages/runner/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/runner/dist ./apps/runner/dist
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
RUN mkdir /data && chown node:node /data && dpkg-query -W > /app/dist/os-packages.txt
USER node
ENV NODE_ENV=production LISTEN_HOST=0.0.0.0 STATE_DIRECTORY=/data
EXPOSE 3001 3443
CMD ["node","dist/api.mjs"]
