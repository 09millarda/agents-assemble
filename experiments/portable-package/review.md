# Independent portable-envelope review

Date: 2026-09-12 · Scope: disposable reader/catalog in `probe.py`, against [#17](https://github.com/09millarda/agents-assemble/issues/17) and [ADR 0010](../../docs/architecture/0010-portable-community-publication.md). This is an independent adversarial experiment audit, not production approval or a full application-schema review.

Run `python3 experiments/portable-package/independent_review.py` from the repository root. The script writes `evidence/independent-review.json`, including the exact subject SHA-256. Initial observations are retained separately in `evidence/independent-review-initial.json`.

## Initial findings

Initial tested source SHA-256: `f4e2063b0aa4fced4301262eb5b9c65f5a48a0cb1bafc0d993a3b9f0c4a4aea3`.

1. **Proof upgrades disappear on replay.** Initially `Catalog.accept` used `INSERT OR IGNORE` for the entire imported manifest (initial line 252). Import unsigned content, then replay the same content carrying valid pinned-key signatures: the second call reports `verified-local-key`, but export still contains zero proofs and verifies as `unverified`. This loses evidence accepted during import and conflicts with preserving portable provenance. Keep immutable content separate from evolving attestations; retain verified evidence upgrades while preventing unsigned replay from erasing prior proofs. Re-evaluate signatures against current local trust; neither a historical badge nor a stored unknown-key proof should become authority automatically.
2. **Conflicting duplicate runtime slot identifiers pass.** Initially `validate_component` checked each slot's shape but did not enforce unique `slot` names. A skill declaring `same/read` and `same/write` was accepted. Reject duplicate identifiers so downstream binding cannot pick first, last, or union semantics accidentally. This concerns the declared reduced fixture schema; it is not a request to implement the full runtime.

The parent had already added canonical manifest equality and malformed-shape normalization before the first independent execution. The pretty-printed manifest is rejected as `noncanonical-manifest`; malformed dependency objects reach the reader and are rejected as `malformed-shape`. These fixes are confirmed observations, not independently reproduced original failures.

## Follow-up findings

The first fixes resolved proof upgrades and duplicate slot admission. Additional probes then exposed three consequences in the expanded implementation:

3. **Equivalent base64 encodings suppress verified proofs.** Python's strict base64 decoder still accepts nonzero unused pad bits. Changing the final meaningful base64 character preserves the decoded 64-byte signature. Replaying that alternative caused export's string-keyed evidence union to classify genuine signatures as ambiguous and omit them. Re-encoding equality now rejects the alternative as `signature-noncanonical`.
4. **Accumulated attestations exceed the reader's own budget.** Eleven accepted manifests carrying three signatures under distinct valid key IDs produce 33 unioned signatures; the exported envelope failed the reader's 32-proof limit. Export must select a bounded set and preserve the fuller history locally.
5. **Origin-only ancestry redaction leaves an incorrect digest.** A nonempty `derivedFrom` pointing to a known component was rewritten to that component's new opaque origin while retaining its old descriptor digest. Since the origin participates in the descriptor hash, the resulting public tuple does not describe the transformed ancestor. Export must map the full approved public tuple or omit the private ancestry and retain its original tuple privately.

The follow-up snapshot is retained in `evidence/independent-review-followup.json`; later probes and final expected-output assertions are in the retained script.

## Verified boundaries and limitations

- Changing only the dependency's bytes at its existing origin/version, while assigning new versions to its parents, raises `catalog-identity-conflict` and leaves the Catalog snapshot unchanged. The identity check covers the entire closure, rather than just the imported root.
- Signed import followed by unsigned replay preserves the stored signed export. The incoming unsigned envelope itself remains unverified; the operation's current-envelope attribution and previously retained evidence are distinct.
- A syntactically valid `derivedFrom` reference containing private-looking origin identifiers is accepted and preserved as unverified metadata. This is expected for an importer, which cannot know a foreign origin's privacy boundary. The private-field rejection case does not prove private provenance detection. Source-side exact public-candidate selection, approval and retained private origin mapping are separate requirements.
- The original unused `stable` mapping was replaced with a real public-candidate transformation that changes private component origins and transitive definition pins, verifies the resulting closure, and checks repeated mapping stability. The mapping is still trusted caller-injected fixture state; durable source-side allocation, authorization and concurrent uniqueness are not implemented by this experiment.
- The reader has no installer or subprocess execution path. The reduced playbook schema is parsed and compared to descriptor pins; arbitrary skill prose remains opaque bytes. Success is not complete ADR 0002 semantic conformance, confidentiality detection, runtime capability enforcement, legal permission verification or key-governance certification.

## Resolution rerun

All **15 independent assertion-backed cases pass** against source SHA-256 `8259aa86541110d497062d61a381e6533ed6ec126019cf5d60547d825ecc8916`. The script hashes the exact loaded source bytes and exits nonzero on any failed expectation.

- Unsigned-to-signed and formerly-unknown-invalid-to-valid replay now preserve exportable verified evidence; reverse replay cannot erase or poison it.
- Canonical base64 rejects equivalent signature encodings before they enter evidence history.
- Eleven distinct trusted key IDs now produce a valid bounded export with three selected proofs, retaining verified attribution for every component.
- Duplicate slot identifiers reject; dependency-only identity conflicts remain atomic.
- Nonempty ancestry uses a complete explicitly approved public tuple, including the actual transformed ancestor digest. Omitting that approval rejects as `provenance-not-approved`.

No demonstrated finding remains unresolved within this bounded reader/catalog experiment. This verdict does not certify production parser security, complete schema semantics, durable issuer mapping/approval policy, arbitrary confidential content detection or deployment resource limits. The broader evidence/limit qualifications above still apply.
