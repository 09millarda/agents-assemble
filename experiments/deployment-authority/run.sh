#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
fixture_name="aa-deployment-authority-$$"
trap 'docker rm -fv "$fixture_name" >/dev/null 2>&1 || true' EXIT
npm ci --ignore-scripts --no-audit --no-fund
docker run --detach --name "$fixture_name" -e POSTGRES_PASSWORD=throwaway -p 127.0.0.1::5432 postgres:17.9@sha256:2a0d0fe14825b0939f78a8cad5cd4e6aa68bf94d0e5dd96e24b6d23af4315545 >/dev/null
for attempt in {1..60}; do
  if docker exec "$fixture_name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.5
done
export PGHOST=127.0.0.1 PGDATABASE=postgres PGUSER=postgres PGPASSWORD=throwaway
export PGPORT="$(docker port "$fixture_name" 5432/tcp | cut -d: -f2)"
node run.mjs
