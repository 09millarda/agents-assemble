# Independent bounded review of decision #12 fixture

Reviewed model.mjs, worker.mjs and run-experiment.mjs on 2026-09-12. The independent in-memory probe is `independent-review.mjs`; `independent-review-results.json` records its inspected model hash and outputs. It adds delete-set dependency coverage; it does not establish database or browser conformance.

## Initial findings and final corrected outcome

1. **Superseded predecessor reopening:** initial inspection found that a later observation changed a superseded predecessor back to `replan_required`, after which retain could resume it or adopt could replace its successor. Parent corrected the model while this review ran. Independent probes now show both attempts return `superseded` and preserve the first successor.
2. **Owner identity collision:** initial source events used doc ID alone, so Knowledge and Catalog could emit the same identity. Parent qualified source with owner/doc and sets owner from the worker's selected context. Independent source probe with the same doc ID now produces distinct identities.
3. **Resolved gate versus unresolved wait:** initial model always created a fresh approval wait after retain, including an already approved unchanged gate. Parent added explicit resolved state and replaces only unresolved waits. Final independent probe preserves the original resolved wait and accepted approval with no extra pending gate, matching ADR 0003.
4. **Reduced graph schema:** initial membership/orphan checking accepted an object-valued action and unknown behavioral fields. Parent tightened the flat call fixture schema. Final independent probes reject both, and still reject duplicate/orphaned nodes. Full ADR 0002 graph validation remains outside this fixture.

Final verification: all eight independent assertions pass on model SHA-256 `4276b19a96a3e2e4dd5d08f482a7d51401c8604c4b07e319543a5a4a486199e5`, with equal pre/post probe hashes. No unresolved finding from these bounded probes invalidates a decision that retains the limits below. This is not a completeness or production-conformance claim.

## Independently passing probe

Delivering a delete-set-only update before its insertion returns a durable but not integrated receipt. Preview is blocked before and after JSON serialization/reconstruction of the persisted model. Delivering the insertion resolves the pending deletion and creates an empty visible Markdown snapshot. This complements the main test of a pending insertion dependency; neither equates state-vector equality with immutable content identity.

## Model omissions that must bound the verdict

- Full playbook grammar/schema, scopes, typed/pinned action references, cycles and graph editor operations are not implemented. Plain object node replacement does not test nested field-level merging or graph move semantics.
- Authentication headers, ACLs, revocation, tenant separation, browser presence and forensic authorship are fixtures/absent. Audit is authenticated-actor responsibility only to the extent the ingress principal is trusted. Do not call this security certification.
- Scope identities in a real protocol need tenant plus owner/source plus epoch; the experiment has no reset/migration epoch or run-admission baseline cursor. New runs begin at sequence zero and therefore require complete source history in this fixture.
- Immutable content uses a local stable JSON rendering and materialized snapshot; this supports exact bytes in the probe, not a cross-language canonicalization/version migration guarantee. A source-scoped revision/digest manifest must remain explicit in the final contract.
- Receipt `integrated` records integration at acceptance time. A pending receipt remains immutable after later dependency resolution; a production UI needs current integration status or a covering snapshot, not reinterpretation of the old receipt.
- Quiescence/checkpoint and admission evidence are controlled values. New successor is embedded model state, not full interpreter admission. There is no native harness or external-effect verification here.
- PostgreSQL roles provide table isolation; the transport/application bridge remains trusted. Source outbox delivery in the driver is controlled injection, not a production relay, subscription authorization or complete missing-history reconciliation implementation.
- The workload uses loopback HTTP and repeated full-state pulls. Even with artificial delay and a 60-second disconnected replica, it is not browser editing/presence or WAN performance certification.
