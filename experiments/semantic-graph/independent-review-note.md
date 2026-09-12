# Independent bounded review of #16 semantic graph probe

The original independent run exercised 17 cases against the actual Yjs model. See `independent-review.mjs` and `independent-review-results.json`. The reviewer did not alter `model.mjs`, its main driver, or inherited authoring reference.

## Defects requiring correction or narrowed claims

1. **Structural edits silently disappear in both representations.** `edit(root, ['children'], [])` writes a fields entry, but `materialize` overwrites it from the separately maintained slot. The operation succeeds, the prior children remain, and the candidate is publishable. Concurrent replacement versus move also loses the replacement without diagnostics. At minimum reject structural-field edits before mutation and detect illegal structural keys during inspection. A real structured replacement command must reconcile entities/slots or remain a separate exact-base proposal; never merge whole nested structures through an ordinary field setter.
2. **Parent representation changes duplicate intent into move.** `duplicate(a, rootChildren, 3)` updates the single placement record, leaving one reordered `a` and no diagnostic. The alternate representation must reject duplicate placement requests or record that unsupported intent as a conflict; this supports preferring array placement observability.
3. **Publication accepts fabricated or changed candidate bytes.** Both `{bytes: 'not JSON', profile: 'semantic-graph-probe/1'}` and a valid frozen candidate modified afterward are accepted. This does not invalidate ADR 0007's previously tested durable protocol, but the current local publication function cannot itself prove exact validated-candidate publication. An opaque candidate ID resolving owner-held immutable bytes, or an explicit trusted-only fixture boundary, is necessary. Revalidating syntax alone would not prove the candidate contains the reviewed conflict resolution cut.

## Inherited validator limits

`discover.with = {literal: 17}` passes despite the fixture action's object input schema. An `end` with literal `17` passes despite the playbook's object output schema. The inherited validator checks binding syntax/scope and selected structural contracts, not complete input/output compatibility. Report complete *field-preserving mapping* distinctly from complete *semantic validity*. General schema subtyping is not required by ADR 0002; the obvious incompatible constant cases nevertheless expose the limits of a publication-readiness claim.

## Positive observations

Unknown behavioral fields remain in materialized drafts and block publication. Both profiles block competing same-gap moves. Self-cycle/orphaned topology blocks freezing. Array duplicate placements remain explicit invalid states. Ordinary unresolved field conflicts block freezing through the legitimate path.

## Evidence limits

These are bounded commands over actual Yjs with controlled in-memory operation records/publication. They do not exercise authenticated server ingress, browser editor bindings, full compiled schema validation, durability, or five-user/native-run qualification. The findings refine #16 only; no second decision was resolved.

## Correction pass

The initial 17-case result is retained separately as `independent-review-initial-results.json`. On the next model version, all 17 original cases are guarded: structural field commands reject before mutation, the parent profile explicitly refuses duplicate placement, owner-recorded candidates reject fabrication/tampering, and wholly constant input/end boundary values are validated. A valid owner-recorded candidate still publishes.

The expanded 20-case run found two additional defects:

- An own `__proto__` JSON property with primitive/null value is lost by native `Y.Map.toJSON`, yet the resulting definition is publishable. Safe recursive conversion from Y.Map entries must preserve own properties.
- A move to an unknown target slot first detaches the source, then throws, leaving changed graph state without its operation record. A Yjs transaction is not rollback; command preconditions must be checked before mutation.

Further claim limits remain unchanged: dynamic input/result compatibility, general JSON Schema subtyping, hostile raw-Yjs ingress validation, full editor command coverage and integrated release qualification are outside this bounded model.

## Final verification

All **20 independent probes pass** against the corrected model. The final rerun verifies safe preservation of the own `__proto__` key and that an unknown-target move is rejected without graph or operation-history mutation. Earlier defects remain recorded above for reviewability; `independent-review-results.json` contains the final outcomes. No model or main-driver code was changed by the independent reviewer.
