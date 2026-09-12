#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
name="aa-drafts-throwaway-$$"
trap 'docker rm -fv "$name" >/dev/null 2>&1 || true' EXIT
npm ci --ignore-scripts --no-audit --no-fund
docker run --detach --name "$name" -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=aa_experiment -p 127.0.0.1::5432 postgres:17.9@sha256:2a0d0fe14825b0939f78a8cad5cd4e6aa68bf94d0e5dd96e24b6d23af4315545 >/dev/null
for attempt in {1..60}; do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d aa_experiment >/dev/null 2>&1; then break; fi
  sleep 0.5
done
export PGHOST=127.0.0.1 PGDATABASE=aa_experiment PGPASSWORD=throwaway
export PGPORT="$(docker port "$name" 5432/tcp | cut -d: -f2)"
export AA_EXPERIMENT_CONTAINER="$name"
node run-experiment.mjs
node build-viewer.mjs
