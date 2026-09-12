# Disposable collaborative draft experiment

Architecture decision [#12](https://github.com/09millarda/agents-assemble/issues/12). **Throwaway evidence. Never merge this experiment into production or main.**

With Node 24/npm and Docker available, run from this directory:

```sh
bash run.sh
```

The command installs locked Yjs 13.6.32 and pg 8.23.0, creates a dedicated disposable PostgreSQL 17.9 container bound only to loopback, runs the probes, writes complete state snapshots and builds a self-contained browser lab. It removes its own container/data on exit. It uses no existing application database, real user content, model credentials, external integration or native harness. The workload includes a deliberate 60-second disconnected replica.

Open `collaborative-drafts.throwaway.html` directly. Its free-play and guided actions are a **separate illustrative in-memory model**, explicitly labeled; its recorded-evidence section contains the actual database snapshots and counters. Browser inspection verified exact-preview behavior, rejection of an old answer after retain, and the layout. The HTML is standalone; no server is required for delivery.

Final run: **31 scenarios, 121 assertions, zero failures**. `results.json` pins the source hashes captured before and checked after execution. `traces.json` contains complete captured owner state/inbox records after every scenario. `load-measurements.json` records 16 loopback samples with artificial 50-ms delay per direction: p95 848.80 ms, reconnect 681.45 ms after a 60.008-second disconnect. This is not release qualification or a real WAN measurement.

`independent-review.mjs` supplies eight additional in-memory assertions; run `node independent-review.mjs` without a database. Its report records four initial protocol defects, their corrections, the final source hash and scope limits. Main evidence and independent assertions are separate counts.

## Fixture boundaries

- `model.mjs`: real Yjs text and plain node-record/order drafts, immutable preview and submitted-head comparison; a reduced single-source Execution model. The graph fixture supports only a flat sequence of call records. It does not implement the full grammar or product graph editor.
- `worker.mjs`: separate PostgreSQL roles/schemas for Knowledge, Catalog and Execution, per-owner transaction lock and inbox/state acceptance. Update history, snapshots, revisions and submission outbox are arrays within the owner's JSON record. This is not a production schema choice.
- `run-experiment.mjs`: two/five independent document replicas through a real loopback HTTP worker, process SIGKILL before/after commit, a PostgreSQL container restart, duplicate/conflicting commands and controlled source event injection into reduced runs. It is not a production relay, browser editor, full interpreter or native human interaction bridge.
- Actor headers/allowlist, subscription routing, checkpoint/effect/writer evidence, admission and delivery mapping are trusted fixtures. There is no production authentication, tenant/epoch handling, presence, revocation, editor pending-storage, full dependency closure validation, retention/compaction, HA or transport security certification.
- Envelope attribution preserves both accepted edits; a deterministic same-key CRDT winner does not preserve both values visibly or prove semantic intent. Pending update receipts remain immutable; current integration is shown by reconstructed state/candidate availability.

Initial harness corrections: Docker startup readiness now checks TCP (not the transient initialization socket), and database restart rediscovers its dynamically allocated loopback port. An intermediate run was discarded after source edits; only the final stable-hash run is retained as passing evidence. No application implementation or license was selected by this scratch package.
