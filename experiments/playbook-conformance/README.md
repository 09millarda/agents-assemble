# Disposable playbook conformance experiment

Decision [#6](https://github.com/09millarda/agents-assemble/issues/6) in the [Agents Assemble architecture map](https://github.com/09millarda/agents-assemble/issues/1). This scratch branch is an archive, not application code and not intended to merge into main.

Open `playbook-conformance.throwaway.html` directly in a browser. All code is embedded; there is no network access or installation. Select a guided scenario, inspect complete snapshots, continue through free-play controls or edit a structured JSON draft. Mock operations create no real PRs and invoke no harnesses.

To reproduce with Node 24:

```sh
node run-experiment.cjs
```

This checks the local TypeScript builder, runs authoring/runtime probes, writes `results.json`, and regenerates the HTML. Add `--traces` to export all full execution/provider snapshots. The executable cases are decision evidence, not a production test suite. Node strips TypeScript annotations; it does not typecheck them.

- `report.md`: verdict, amendments, evidence and limits.
- `authoring-report.md`, `adversarial-review.md`: independent investigation/review, including initial failed counterexamples and final status.
- `fixtures.json`, `authoring.js`, `builder.ts`: materialized examples, pinned mock catalog and local builder/document round trips.
- `runtime.js`, `scenarios.js`: disposable interpreter, mock boundaries and guided experiment cases.
- `shell.html`: UI source around the embedded modules.
- `reference/`: original ADR/example inputs before this session's amendments.
- `decisions/`: snapshot of resulting planning records; the canonical published index remains issue #1.

JSON snapshots establish only simulated behavior. Actual process/database durability, transactional inbox/outbox, timers/backoff, lease fencing, tenant policy, Git checkpoints and harness/provider compatibility need separate proof. The next unclaimed decision is [#7](https://github.com/09millarda/agents-assemble/issues/7).
