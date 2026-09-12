# Disposable runner recovery experiment

Decision [#8](https://github.com/09millarda/agents-assemble/issues/8), following ADR 0003. This branch contains throwaway probes and evidence, not production application code. Decisions are recorded separately in ADR 0004 on the main branch.

The question is whether a durable customer-runner journal can preserve the service's admitted invocation across receipt, native start, checkpoint and result failures, and whether the installed native harness can recover useful work from independently verified Git/artifact context.

## Read the evidence

- `PROTOCOL.md`: minimum contract and explicit trust/authority boundaries.
- `daemon/probe.py`, `daemon/evidence.json`: durable local journal and controlled service fixture with actual SIGKILL/loopback disconnects. The child is a harmless local counter/Git process.
- `native/README.md`, `native/results/`: actual installed Codex App Server account compatibility, initial fix and fresh-session reconstruction from a self-contained Git bundle.
- `native/kill-results/`: real accepted native turn interrupted by App Server SIGKILL, surviving tool descendants and explicit unknown-outcome pause. `native/kill-precondition-pid-namespace/` preserves the earlier unsuccessful fault-injection precondition.
- `protocol-review.md`: independent requirements and source/evidence review.
- `review-native-check.py`, `review-native-check-results.json`: independent archive reconstruction and original-run fixture-integrity audit, without new inference.
- `review-daemon-check.py`, `review-daemon-check-results.json`: 25 independent adversarial assertions against the final daemon source, separate from its 26 scenarios.
- `runner-recovery-lab.html`: self-contained browser model and embedded full recorded JSON. Open it directly; no build or server is needed. The browser model is illustrative and is not counted as a fault probe.

## Reproduce

From this directory, on a compatible Linux machine with Git and Python 3:

```sh
python3 daemon/probe.py suite --output /tmp/runner-daemon-rerun.json
python3 review-native-check.py
python3 review-daemon-check.py
```

The daemon suite creates fresh temporary journals and Git repositories. SQLite WAL with `synchronous=FULL` is a fixture choice; the production Execution substrate remains PostgreSQL under ADR 0003. Its transport is real local HTTP with controlled lost replies, with trusted identity/provenance. It does not establish authenticated tunnel behavior or real native-harness fault durability. The independent native checker can always replay the archived bundle/patch; the additional original-workspace audit is available only while the recorded temporary workspace remains present. Re-running that checker updates its local result file.

Actual native inference and the native crash probe have separate commands and prerequisites in [`native/README.md`](native/README.md). They use the existing native account without reading or copying its credentials and use normal account inference usage. The successful checkpoint path creates fresh ephemeral threads; native transcript migration is not part of that claim.

The native crash probe demonstrates that App Server exit is insufficient stop evidence. Its cleanup accounts only for exact observed Linux descendants. Production native supervision, direct credential effects, transport authentication, grant/receipt provenance, corruption/retention, other hosts/OSs and full integrated conformance remain unproved.

Regenerate the standalone viewer after intentionally updating evidence:

```sh
python3 build-viewer.py daemon/evidence.json native/results/results.json native/kill-results/results.json review-native-check-results.json review-daemon-check-results.json
```

Only immutable decision records belong on main. Keep this experiment archived separately.
