# Project-scope cutoffs: disposable experiment

Architecture decision [#19](https://github.com/09millarda/agents-assemble/issues/19).
This directory is throwaway evidence and is not production application code.

The experiment exercises the bounded ADR 0014 contract with real PostgreSQL
transactions, separate context schemas, durable inbox/outbox rows, and child
process termination before and after commit. It does not exercise a full
interpreter, authenticated transport, provider behavior, GitHub, AWS, or a
production authorization adapter.

With a PostgreSQL instance available on localhost:

```sh
npm ci --ignore-scripts --no-audit --no-fund
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=aa_scope_throwaway \
  node run-experiment.mjs
node independent-review.mjs
```

The controller creates and resets only the dedicated `aa_scope_throwaway`
database. `results.json` is sanitized reduced state and assertion evidence.

