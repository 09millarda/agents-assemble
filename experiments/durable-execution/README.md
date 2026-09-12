# Disposable durable execution experiment

Architecture decision [#7](https://github.com/09millarda/agents-assemble/issues/7). **Throwaway evidence; never merge this code into production.**

From this directory, with Docker and Node 24/npm available:

```sh
bash run.sh
```

The command installs the locked experiment dependency, creates a dedicated PostgreSQL 17.9 container bound only to localhost, executes the worker/process/database crash probes, writes `results.json` and `traces.json`, builds the single-file viewer, then removes that container and its disposable data. It does not use an existing application database. Image digest and client version are pinned experiment inputs, not a license or production dependency decision.

Open `durable-execution.throwaway.html` directly to replay recorded evidence. It embeds the complete results and every captured context record, inbox and outbox. It never connects to a database or reruns commands. Run `node build-viewer.mjs` to regenerate it from existing real results.

Final recorded run: **28 scenarios, 353 assertions, zero failures**. `latest-run.log` contains the command output. `independent-recovery-review.md` records a separate review/container and **22 additional assertions** for repaired wait/retry behavior; those are not included in the main suite count. Browser inspection verified scenario selection, navigation and the lost-publication-receipt snapshot.

`worker.mjs` is a reduced PostgreSQL transition model with five independently privileged schema owners. `run-experiment.mjs` is a privileged fixture/transport/controller, not production application code. `PROTOCOL.md` documents its exact commands, trust assumptions and restrictions. Provider behavior, authenticated intent transport and checkpoint verification are fixtures. This does not port #6's full interpreter or certify real harnesses, providers, tenant authorization, HA, throughput or recovery liveness for every uncertain outcome.
