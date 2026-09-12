# Throwaway shared-conversation decision experiment

Wayfinder #13. This branch archives evidence only. Do not merge its implementation into main.

Open `conversation-lab.html` directly in a browser: it is one self-contained offline file with free-play controls, guided walks and complete retained evidence. Its illustrative reducer is separate from the durable fixture and not counted as empirical evidence.

From this directory:

```sh
python3 run_experiment.py
python3 independent_final_probe.py
python3 native/audit.py
python3 build_lab.py
```

The first two commands use temporary separate SQLite WAL journals (`synchronous=FULL`). The five process-crash cases wait for an observed stopped barrier, SIGKILL the owned worker and reopen the journals. Native calls and authority in this fixture are modeled. The production service substrate remains PostgreSQL.

Actual native scripts are opt-in: `python3 native/probe.py` and `python3 native/persistent_probe.py` invoke installed Codex through the existing native login and consume native account usage. They use a temporary workspace, synthetic messages and harmless bounded sleep commands. They do not read/copy auth files; child environment is allow-listed. The persistent script archives its own thread. Never point these probes at an existing user's thread. Model/effort are omitted and inherited; the captured settings record what actually ran.

The first ephemeral run used `native/probe-v1.py`. It mistakenly projected `clientUserMessageId` from user items instead of `clientId`; its null fields establish nothing about native client correlation. `native/probe.py` fixes that projection, and the separately executed persistent probe supplies all positive client-ID and duplicate readback evidence. One first-run case labels a response withheld from a hypothetical caller; that is not an actual native transport fault. Actual process-death injection belongs to the separate durable fixture.

Only supported non-reasoning item types and synthetic text are retained; delta bodies, tool output bodies, native account PII, credentials and native session IDs are omitted. Native IDs in errors are consistently aliased for the published archive. Raw stderr is discarded and only its byte count retained. Selected generated protocol type excerpts and hashes are in `schemas/` and `schema-evidence.json`; these imports are excerpts, not a buildable package.

`protocol-before-review.py`, `evidence-before-review.json` and `independent-probe-results.json` retain the original flaws and passing-but-insufficient scenario set. `independent-review.md` explains the repairs; `independent-final-results.json` records the final adversarial checks. Do not treat the original suite as certifying the original model.

Limits: no integrated native/production crash recovery; no protected observer, TLS or real multi-user auth; no byte-bound output relay, real snapshots or power-loss certification. The output fixture validates an explicit numeric cursor and three-record retention, not complete production event binding. Native interruption never proves all writers stopped. The model grants no replacement admission.
