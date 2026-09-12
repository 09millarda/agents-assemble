# ADR 0008: semantic graph collaboration and authoring round trips

Date: 2026-09-12  
Status: **Select stable entities with ordered child placements for the bounded Yjs profile. Full field preservation demonstrated; production editor and semantic validator not certified.**  
Decision: [#16](https://github.com/09millarda/agents-assemble/issues/16) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)  
Depends on: [ADR 0002](0002-playbook-and-action-contract.md), [ADR 0007](0007-collaborative-drafts-and-revision-submission.md)

## Decision

Retain the structured playbook grammar and Yjs collaboration substrate. Represent a draft with stable editor entity records, field-granular shared objects, and ordered child-placement arrays containing entity references. Keep structural placement separate from node content. Moves change references, not the identity or copied contents of a nested shared node. Keep deleted entities and conflicting proposals reviewable until the owner's retention policy permits removal.

Select this over the tested alternative of one atomic `{parent, slot, rank}` placement per entity. Both preserve supported definition data. Arrays directly preserve ordered sequence/choice slots and expose duplicate placement after incompatible concurrent moves. A single parent value can converge to one apparently valid placement while hiding the losing move; it still needs operation-history conflict checks and introduces rank/tie maintenance. Arrays also require explicit conflict checks: deterministic insertion order alone does not settle intent in an executable sequence or ordered choice.

This is a bounded representation choice, not a production encoding, editor library, permission model, generic tree CRDT or guarantee of intention preservation under every edit. [Evidence and limitations](../research/semantic-graph-conformance.md) distinguish actual Yjs behavior from controlled acceptance/publication fixtures.

## Identity and representation

| Element | Selected contract |
| --- | --- |
| Editor entity ID | Unique within a draft epoch, stable across move/reorder and field edits. Separate from a playbook's author `id`. |
| Author node ID | Retain ADR 0002's lexical uniqueness and no-visible-shadowing rule. The same author ID in disjoint scopes must not collapse into one editor record. |
| Shared fields | Node/envelope values use field-granular shared objects. The bounded adapter treats non-structural JSON arrays as atomic structured values; replacing one is an explicit edit with conflict tracking. It does not imply per-element collaboration for every array. |
| Structural slots | Sequence children, named parallel branches, ordered choice cases and `otherwise`, fixed repeat/forEach bodies. Choice-case wrapper entities retain their condition and child identity through reorder. |
| Placement | Ordered primitive entity references, never reinsertion of an already integrated shared node. A node must have exactly one executable placement in a valid rooted draft. |
| Tombstone/history | Retain entity content and accepted edit proposals separately from its active placement. A hidden/deleted node is not evidence that its concurrent edits never happened. |
| Portable output | The complete normalized declarative document and pinned manifest. Editor IDs, operation journals, tombstones and presence do not become execution nodes or authority. |

Every behavioral field must have a lossless editor binding or structured editing surface. A field setter cannot also replace `children`, `cases`, `body` or another structural slot. Such edits use explicit structural commands or an exact-base replacement proposal under ADR 0007. Silently overwriting a field during graph materialization is prohibited. Import/export must preserve arbitrary own JSON keys, including inside opaque namespaced metadata; use safe materialization rather than assuming a library's object conversion is lossless.

Generated TypeScript represents the complete normalized data. Local authoring helpers may construct that data, but source comments, abstractions and helper choices need not round-trip. No function/callback crosses the document boundary. Unknown required formats or behavior remain raw-exportable and read-only; they cannot be saved as an editable executable approximation.

## Concurrent editing and review

Convergence, semantic validity and reviewed intent are separate gates. Independent field edits and an unrelated content edit during a move can merge. Conflicting writes to the same field, replacement of an object versus its descendant edit, competing placements, deletion versus affected edits, and competing edits at the same ordered gap require visible review. Cycles, duplicate placements, unreachable live entities, missing/deleted targets, invalid slot cardinality and scope/reference errors block publication. Never choose a parent, delete an orphan or reorder a branch automatically merely to obtain a valid executable tree.

Show the conflicting operations and preserved values/placements, the current materialized draft and actionable diagnostics. A person deliberately repairs the converged draft or accepts a visible winner, then resolves the exact observed conflict identities. A later disconnected operation can create a new conflict and needs fresh review. Resolution does not acknowledge unseen future edits or exempt the result from full validation.

The owner must derive and retain immutable accepted operation identities, authenticated authors, causal bases and complete semantic write sets. These are **not** trusted client assertions or mutable CRDT history. ADR 0007's durable envelope acceptance must bind the bytes actually applied to the validated command and its semantic effects. Yjs client IDs, transaction origins and a client-supplied `seen` list cannot establish identity or authorized resolution. The experiment places controlled intent records in its in-memory document solely to exercise conflict rules; it does not prove hostile raw-update validation or production provenance.

Validate command prerequisites before mutating a Yjs document. `transact` batches observations; it does not roll back a failed command. For server acceptance, stage candidate application and validate it before committing the owner-local update/verdict, as required by ADR 0007. Invalid intermediate graph semantics may remain an acknowledged draft; unsupported/malformed commands or encoding must not partially apply without their accepted history.

## Validation and exact publication

Materialization is lossless transformation, not proof of semantic validity. Validate the complete definition against the supported format, schema/expression profile, node and binding scopes, branch contracts, bounds, dependency closure, runtime requirements and policy. Keep invalid drafts reviewable. Publication must reject unsupported behavior and unresolved conflicts while leaving earlier versions intact. Validate actual dynamic values at action/result boundaries; do not claim arbitrary schema subtyping has been solved.

The bounded experiment reuses #6's small schema and mock action catalog, supplements known constant action/end boundary checks, and verifies every accepted node kind and behavioral field in its fixtures. It does not implement a complete production validation profile, imported dependency resolver or all possible schema compatibility checks. Those remain explicit specification and conformance work before product publication is enabled.

Under ADR 0007, the owner stores exact normalized candidate bytes, validation/normalization versions and the accepted cut. Publication resolves the owner's candidate, compares the expected submitted head and retains stable operation verdicts. Caller-supplied replacement bytes are not the reviewed candidate. Continuing to edit cannot change that candidate, an older publication or a pinned run manifest.

Catalog publication provides an immutable version for future runs. An existing lineage receives a change only through an explicit authorized proposal naming that exact version/closure and lineage. Execution separately observes and applies its pause/retain/adopt protocol. The #16 experiment exercises this distinction in memory; #12 remains the separate evidence for PostgreSQL acceptance. No new durable or integrated Execution claim follows from #16.

## Consequences and remaining work

The selected representation makes conflicts inspectable without changing the accepted grammar. It needs a domain-aware command/validation adapter and a repair UI; Yjs alone cannot supply either. The raw structured fields, placement views and immutable candidate preview must agree on all supported behavior.

Still required: authenticated command/update binding and immutable intent history; full production schema/dependency/compatibility validation; complete creation, rename/refactoring, undo/redo and subtree repair commands; browser editor bindings/accessibility/presence; history compaction, epochs and retention; integration with #12's actual owner persistence and Execution lineage routing; and five-collaborator/two-native-run release qualification. These remain in map #1's unresolved work, not speculative implementation tickets. This session resolves only #16.
