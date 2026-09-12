# Semantic graph collaboration — disposable #16 experiment

This is throwaway architecture evidence, not a product editor, production validator or reusable SDK. Decision: https://github.com/09millarda/agents-assemble/issues/16.

## Reproduce

With Node 24 and npm, from this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run experiment
node independent-review.mjs
node build-viewer.mjs
```

Open `semantic-graph.throwaway.html` directly. It includes all recorded states and an independent single-editor revision sandbox, requires no server/network, and does not run Yjs in the browser. Real two-replica Yjs behavior is exercised by the Node driver. The browser lab is an evidence walkthrough, not a graph editor implementation.

`model.mjs` compares stable entities + child arrays with stable entities + an atomic parent/rank value. `run-experiment.mjs` records 50 scenarios/242 checks. `independent-review.mjs` records 20 additional probes. `results.json` contains complete snapshots, convergence comparisons and the 100-node measurements. The main result fingerprint covers model/driver bytes; `source-hashes.json` additionally covers the reference authoring fixture, local builder, lockfile, review and viewer source. Re-running changes client IDs and timing samples naturally.

The reference authoring validator/fixtures and independent feature builder come from #6 at `989cae8`; the builder import path and default export are adapted for this experiment. Generated `.ts` files emit the three normalized supported documents through Node type stripping; this is not a `tsc` check or preservation of original source abstractions.

## Boundaries

- Actual Yjs 13.6.32 binary updates and independent documents; no transport, database, account or service process.
- Controlled in-memory intent records. Production must derive immutable identities, causal bases and semantic write sets from authenticated owner-accepted commands. Client-authored `ops`, `seen`, Yjs client IDs and transaction origins are not trusted authority.
- Structural child arrays/slots are separate from fields. Nested object leaves are shared maps. Non-structural JSON arrays are atomic structured replacements; overlapping replacements require review. New complex subtree creation, rename/refactoring, undo/redo, arbitrary graph gestures and editor accessibility remain unimplemented.
- Publication uses owner-held frozen candidates, expected-head and operation receipts in memory. Existing run manifests stay unchanged; explicit targeted proposals are separate. This neither reruns nor extends #12 PostgreSQL conformance.
- The inherited small schema/action catalog checks selected grammar, bindings, scope, bounds, pins and policy. Known constant action/end values now receive boundary validation. Dynamic values, production schema profiles, general schema compatibility and the full portable closure remain separate requirements.
- Raw Yjs mutation is not a supported ingress API. The probe detects structural-field collisions but does not authenticate arbitrary binary updates or prove that every malicious update has a complete semantic command envelope.
- The 100-node measurement has two in-process replicas and no network/browser latency, durable storage, five collaborators or native runs.

The independent note retains initial failures and corrected behavior. Never merge this experiment into main; only the ADR/report belong there.
