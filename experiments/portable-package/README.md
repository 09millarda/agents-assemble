# Portable package envelope — THROWAWAY #17 experiment

Question: can two disconnected Catalogs preserve a complete immutable dependency closure while keeping byte integrity, issuer evidence, redistribution policy and execution authority separate?

This is an archived Python experiment, not production application code or the TypeScript SDK. The `aa-probe/1` three-component schema is deliberately smaller than ADR 0002. Only the architectural decision and research notes belong on main.

Run from this worktree:

```sh
python3 experiments/portable-package/probe.py
python3 experiments/portable-package/independent_review.py
python3 experiments/portable-package/build_lab.py
```

Observed environment: Python 3.14.4, SQLite 3.46.1, cryptography 46.0.5. The experiment uses Python standard-library ZIP/JSON/SQLite facilities and cryptography's Ed25519 implementation. Reproduction in a fresh environment needs that cryptography dependency; no production package version is selected. `probe.py` generates a fresh ephemeral signing key, retains only its public key and signed synthetic bytes, uses temporary Catalog databases, and removes those databases on completion. Evidence signatures and timing measurements vary on rerun; outcomes should not.

Open `lab.html` directly in a browser. It contains the complete main report, guided evidence selections and a clearly labeled illustrative in-memory free-play model. It requires no server or network. To serve it optionally: `python3 -m http.server 8767 --bind 127.0.0.1 --directory experiments/portable-package`.

## Evidence

- `probe.py`: strict archive verifier, bounded JSON, component identity/closure checks, actual signatures, two independent SQLite Catalogs, public-candidate transform, and 75 main scenarios.
- `independent_review.py`: 15 assertion-backed adversarial cases; fails its process on an unmet expectation and records the exact loaded source hash.
- `evidence/report.json`: all main outcomes, selected complete byte/metadata Catalog snapshots, synthetic private/public transformations, runtime and finite limits. Expected rejection cases retain their rejection reason; not every pure parser case has a separate full input archive.
- `evidence/fixture.zip` and `evidence/trust.json`: signed synthetic three-component transfer and toy public trust record. No signing private key is retained.
- `evidence/source.sha256`: hash of the final main probe used for its evidence.
- `evidence/independent-review*.json` and `review.md`: initial/follow-on failure observations and final passing audit. The initial source revisions were not separately archived; their observed hashes and outcomes are retained.
- `evidence/browser-review.md`: actual lab interactions inspected through the in-app browser.
- `archive-sha256.json`: hashes for retained files, excluding itself and Python bytecode.

## Interpretation

Network creation is disabled in-process during the two-Catalog transfer; this is not OS network-namespace isolation. Import paths never invoke package code. A shell resource is retained with subprocess dispatch disabled. Three separate child processes exit at the specified SQLite transaction boundaries; actual reopening verifies all-or-nothing registration and exact retry. SQLite is a bounded experiment, not a replacement for the selected PostgreSQL substrate or a power-loss/object-store durability certification.

The closure cycle and missing-edge algorithm cases use synthetic digest nodes separately: an honest self-consistent cryptographic cycle is not constructible as an ordinary authoring fixture. Source-origin mappings, exact ancestry approval, local key scope and redistribution permission are supplied policy fixtures. Tests exercise transforms, rejection and cryptographic checks; they do not prove a production allocator, identity system, confidentiality detector, license review, broad playbook semantic validator, key governance, advisory cutoff or execution grants.
