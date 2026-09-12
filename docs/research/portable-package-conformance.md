# Portable package conformance experiment

Date: 2026-09-12 · Decision [#17](https://github.com/09millarda/agents-assemble/issues/17) · [ADR 0012](../architecture/0012-portable-package-envelope-and-verification.md)

## Verdict and archive

Select strict ZIP_STORED, bounded canonical metadata, exact content-addressed component closures, local issuer-scoped Ed25519 verification and atomic Catalog import. Preserve immutable content separately from accumulated evidence. Public transformation must rebuild references/digests and map complete ancestry tuples. Imported content supplies no execution grant.

[Disposable source, synthetic archive, complete recorded snapshots, independent audit and offline lab](https://github.com/09millarda/agents-assemble/tree/93ea22c/experiments/portable-package) are archived at `93ea22c` on `codex/prototype-portable-package`. Only planning records enter main. `archive-sha256.json` hashes retained files. The main and independent final reports both bind the tested `probe.py` SHA-256 `8259aa86541110d497062d61a381e6533ed6ec126019cf5d60547d825ecc8916`.

## Evidence and results

| Evidence | Observed result | Interpretation |
| --- | --- | --- |
| Main probe | 75 scenarios passed, including expected rejections. | Actual byte/parser/signature checks, a reduced schema, policy fixtures and local persistence; these categories are not interchangeable. |
| Independent adversarial review | 15 assertion-backed cases passed after repairs. | Source-bound verification of evidence upgrades, alternate encodings, proof budgets, dependency conflicts, slot uniqueness, private-origin limitations and exact ancestry transformation. |
| Two independent SQLite Catalogs | Complete three-component closure transferred while in-process socket creation was disabled. | Definitions, instruction/resource/schema bytes, notices, capability requirements, origin/version/digests and signatures survived. Archive order/timestamps changed transport digest without changing closure identity. |
| Actual child-process termination | Exit after blobs, before commit and after commit; each database reopened and retried. | Precommit exits exposed zero registered content; postcommit exit retained complete content; retry registered one root. This is process-crash SQLite evidence. |
| Browser lab | Unsigned/signed import, identity conflict and denied execution controls; crash and redaction evidence selections inspected. | Readable complete state and evidence presentation; free-play is explicitly illustrative. No user approval or production UI conformance is implied. |

The main `evidence/report.json` retains every named outcome and rejection reason, with complete Catalog byte/metadata snapshots for the offline transfer, evidence transitions and crash cases, plus private/public transform manifests. It does not retain a separate standalone malformed archive for every pure parser case; the reproducible script constructs them. The three-component closure consists of one reduced playbook, a skill and its transitive schema. No complete first-release playbook or execution is certified.

## Actual reader and cryptographic checks

The fixture manually validates ZIP local/central/end records rather than calling extraction APIs. It rejects truncation, trailing bytes, unsafe paths, duplicate members, links, unsupported flags/compression/descriptors, contradictory local/central metadata and digest mismatches even when archive CRC is valid. A compressed repetitive payload is rejected at the format gate without decompression. Boundary cases exercise stored-member size, entry count, manifest size, total archive size, safe integer range, string length, JSON depth/nodes and component count.

The JSON path rejects duplicate keys, unsupported numeric domains, lone surrogates, non-ASCII metadata keys and noncanonical manifests. The small supported schema validates declared entrypoint/reference pins, slots and requirements, rejecting unknown fields and unsupported schemas. Component and closure checks cover missing/extra content and immutable identity for every dependency. The cycle and missing-edge algorithm probes deliberately use synthetic graph IDs separately: they are not honestly hashed cyclic archive fixtures.

Ed25519 operations use actual keys and signatures from cryptography 46.0.5. Tests distinguish unknown claims, locally verified keys, wrong issuer scope and invalid signatures. Keys are ephemeral; only the toy public trust record and synthetic signed bytes are retained. Locally configured issuer scopes are policy fixtures, not independently established organizational ownership. Signature success supplies neither redistribution permission nor a runtime grant.

The main runner observed Python 3.14.4 and SQLite 3.46.1. Selected local case timings are retained for diagnostics, but omit some compound scenarios and are not benchmarks, release targets or a total wall-clock measurement. No performance qualification is claimed. The [primary-source note](portable-package-sources.md) explains the standards and library behavior behind the selection.

## Independent findings and repairs

The audit found five defects across its initial and follow-up investigations:

1. **Signed replay lost evidence.** Keeping only the first imported manifest meant unsigned-first import followed by valid signed replay still exported unsigned content. Immutable content now has separate append-only accepted evidence records, and export rechecks them against current policy.
2. **Duplicate runtime slot identifiers passed.** Conflicting requirements could leave later consumers choosing first/last semantics. The reduced schema now rejects repeated slot IDs.
3. **Equivalent base64 encodings erased proofs.** Nonzero padding bits decoded to the same valid signature but created distinct strings, which the evidence selection treated as ambiguous. Ingress now requires canonical re-encoding equality.
4. **Accumulated proofs exceeded the receiving limit.** Eleven valid key IDs over three components produced 33 exported proofs. Export now chooses one proof per component, preferring currently verified scoped keys while retaining the original evidence locally.
5. **Ancestry redaction retained a wrong digest.** Changing the ancestor origin without its digest could refer to no actual public component. Public transformation now requires the full approved origin/version/digest mapping, or rejects candidate creation; original ancestry stays private.

Final independent probes also confirm both poisoning orders: unknown invalid evidence cannot displace an earlier verified proof or block a later genuine upgrade. Changing a dependency at its existing version conflicts even when its parents have new versions, leaving the Catalog unchanged. Current trust is re-evaluated rather than copied from a historical badge.

Initial/follow-up negative observations and their source hashes are retained alongside final results. Those initial source revisions were not separately archived; the archive contains the final reproducible implementation and the original observed evidence. The early main script also corrected an overly narrow logical-filename expression and a syntax error before producing final evidence. Neither initial success nor any passing count is presented as proof of an unrestricted secure importer.

## Public transform and policy limits

The exporter transforms actual synthetic private-origin descriptors using a supplied stable source-owned mapping. It repins transitive definition references, verifies the new closure, preserves a private-only map and repeats identically for the same source/selection. A changed repeat export conflicts with the existing public origin/version. Changed file bytes invalidate both root/closure digests and the illustrative exact approval comparison.

The nonempty ancestry case maps a private predecessor to its actual transformed public tuple and changed digest. Missing approved ancestry mapping rejects. This checks transformation and exact identity, not durable concurrent allocation, authenticated source ownership, namespace transfer or a production approval protocol. Foreign private-looking provenance is syntactically valid and passes the importer; an independent probe documents that limitation explicitly. Arbitrary prose can contain private data, so explicit selection/review remains essential and cannot be replaced by field checks.

Synthetic allowed/denied/missing permission records and an Apache-2.0 allowlist exercise product-gate mechanics only. The fixture does not implement the complete OSI software/resource terms policy, apply project licenses or establish any actual third-party redistribution right. Terms/notices travel intact. Advisory evidence shows that the transitive schema is addressable by its imported identity/digest; no advisory authorization, propagation cutoff or Execution hold is exercised.

The offline round trip disables socket creation in the Python process, not through OS network isolation. The reader has no URL-fetch or package-execution path. An inert shell resource survives import with subprocess dispatch disabled; this does not qualify every future renderer/adapter. Import preserves declared capability slots without selecting concrete runtime/environment bindings.

## Remaining work

Full ADR 0002 semantic/compatibility validation, production TypeScript encoding, safe rendering, durable opaque-origin/ancestry allocation, authenticated exact-candidate approval, cumulative evidence quotas/retention, issuer enrollment/rotation/revocation and namespace disputes remain to implement or specify. SQLite acceptance does not certify PostgreSQL/object-store durability, distributed publication, power-loss recovery, high availability or concurrency throughput. Catalog/Execution moderation/admission composition and release qualification remain unproved.

This resolves the bounded envelope decision #17. Existing map fog already covers the remaining production work; no speculative child tickets are created. Decisions #11 and #15 remain independent frontier work.
