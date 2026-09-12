# Independent targeted protocol review

**13/13 targeted checks pass** against source `ff1c003035d012260b9d65c14064622de09e2c5311c4d27940656c7d04fba736`. No native requests; no full-suite rerun. Full-suite source hash matches: `True`.

The review originally found reachable admission through a stale predecessor, missing replacement registry eligibility, and non-serialized local receipt allocation. The executable regressions independently check those boundaries, relevant side-writer/effect obligations, unrelated-occurrence isolation, accepted replay immutability, and historical receipt scoping.

Limits: Controlled SQLite protocol only; trusted identity/OS scope/checkpoint/effect fixtures remain assumptions. Four native runs and native archive assertions are separate evidence and are not counted here. The concurrent test is one synchronized two-observer run, not a general concurrency proof.
