# Semantic graph collaboration: bounded conformance evidence

Date: 2026-09-12. Decision [#16](https://github.com/09millarda/agents-assemble/issues/16), [ADR 0008](../architecture/0008-semantic-graph-collaboration.md), map [#1](https://github.com/09millarda/agents-assemble/issues/1).

## Verdict

Select stable editor entities with ordered child-placement arrays and explicit conflict/publication gates. Retain ADR 0002's grammar and ADR 0007's Yjs/submission boundary. Both tested mappings preserve the supported definitions; arrays make incompatible placement visible without introducing parent-rank conflict resolution. Neither mapping alone guarantees semantic validity or user intent.

[Disposable code, complete snapshots, generated TypeScript, independent review and offline lab](https://github.com/09millarda/agents-assemble/tree/a4ce555/experiments/semantic-graph) are archived at `a4ce555` on `codex/prototype-semantic-graph`. No prototype code is merged into main.

## Reproduction and evidence

Use Node **24.21.0** and the lockfile's **Yjs 13.6.32**. In `experiments/semantic-graph`, run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run experiment`, `node independent-review.mjs`, then `node build-viewer.mjs`. Open `semantic-graph.throwaway.html` directly; it is self-contained and needs no server. The browser page walks captured real-Yjs states and offers a clearly labeled single-editor revision sandbox; it does not run the Yjs collaboration experiment in the browser.

Final main evidence: **50 scenarios, 242 checks, all passing**. Independent final review: **20 probes, all passing**. The recorded model/driver SHA-256 is `4e79a3fa52e4eeeb14e6a259fea475181ef523daffadb5266e216ea51dba82a3`; `source-hashes.json` also identifies reference authoring/builder, lockfile, reviewer and viewer sources. Random Yjs client IDs and timing measurements vary on rerun.

| Probe | Observed result |
| --- | --- |
| Complete feature, bug and fan-out definitions | Both representations round-trip normalized JSON through actual shared documents and generated local TypeScript. All seven node kinds, bindings, scopes, ordered arrays, pins, slots and policies are retained. |
| Local helper authoring | #6's independent feature builder reconstructs the feature, then survives graph field edit/restore. Node strips annotations; no `tsc` check or original-source reconstruction is claimed. |
| Choice and nested structures | Choice-case identity/order, all condition operators, repeat/forEach bodies and output bindings survive materialization; deliberate reorder/restore preserves the normalized definition. |
| Identity and independent edits | Disjoint nested edits survive; a moved entity retains an independently edited field; duplicate author IDs in disjoint scopes remain distinct editor entities. |
| Concurrent delivery | Two independent Yjs documents converge after exchange; a third verification replica receives updates in reverse order, and duplicate application does not change results. |
| Conflicting field and structural changes | Same-field/object-versus-descendant conflicts, incompatible moves, same-parent reorders and same-gap insertions/moves are blocked pending review. Arrays expose duplicate placements; the parent alternative hides one placement but still has an intent conflict. |
| Deletion and topology | Parent deletion versus insertion leaves a visible orphan/conflict. Deleted-node edits remain in the proposal history. Cycles/unreachable nodes, duplicates and concurrent-branch `end` cannot freeze. |
| Definition rejection | Unknown formats, behavior, schema keywords/references, dependency drift, missing runtime slots/capabilities, unbounded repeat, bad policy, malformed/out-of-scope pointers and visible ID shadowing block publication. Unknown required behavior prevents editing while preserving raw export. |
| Reviewed recovery | Deliberate repair plus acknowledgement of exact conflict identities restores publishability. A later unseen offline edit requires new review. |
| Candidate/publication boundary | Owner-recorded candidate bytes remain exact during continued editing. Tampered/fabricated candidates reject; stable retries replay; stale expected heads conflict. Publication does not alter a run; an explicit targeted proposal separately supplies a newer immutable input. |

The driver imports the small #6 authoring fixture and mock catalog from `989cae8`, rather than quietly inventing another grammar. Independent review added checks for known constant input/result mismatches. This is complete field preservation over the supported fixtures, **not** proof of complete production semantic validation, general schema compatibility, all command combinations or a production editor.

## Defects found and corrected

- A generic field edit could write `children`, then lose it when materialization overwrote that field from structural slots. The command now refuses structural-field edits; materialization also diagnoses illicit structural-field collisions. Whole structured replacement needs its own explicit protocol.
- The parent representation's duplicate command silently became a reorder. It now explicitly refuses that unsupported operation; arrays retain duplicate placement as invalid state.
- The initial publisher trusted caller-supplied candidate bytes. It now resolves and compares owner-held candidates, rejecting fabrication or modification before revision creation.
- The inherited validator accepted plainly incompatible constant action inputs and `end` results. The bounded addition checks wholly known values against their boundary schemas. Dynamic values still need runtime validation, and broader compatibility remains unproved.
- Native `Y.Map.toJSON()` lost an own `__proto__` property in the tested metadata. Safe recursive conversion through map entries preserves it, including in state comparisons.
- A move to a nonexistent target detached its source before throwing. Preconditions now reject it without graph/history mutation; a Yjs transaction was not a rollback boundary.

The independent archive retains initial defects and final corrected outcomes. Browser inspection also caught a lab-generation replacement-string bug; callback-based embedding fixed it. The corrected browser walkthrough visibly showed duplicate placement and unresolved intent blocking publication, and the revision sandbox showed draft limit 2 while reviewed and published limits remained 3.

## Qualification limits

The 100-node fixture contains one root and 99 action nodes. Two in-process replicas performed 20 edit/merge/materialization samples. Recorded p95 was **32.84 ms**, with **35,791 bytes** in the final Yjs state update. These measurements include neither network nor browser-rendering latency, durable writes or native runs; they cannot be compared as an end-to-end release qualification result. Twenty samples are not a capacity estimate.

Actual library behavior is separate from the controlled in-memory intent/publication model. There is no database, authenticated relay, durable offline queue or production ingress validator here. Client-supplied `ops`/`seen` fields cannot be trusted as immutable attribution in a real service. #12 supplies separate reduced PostgreSQL evidence; #16 does not claim that its complete graph now runs through that durable adapter.

Unimplemented work includes authenticated semantic command/update binding, full schema/closure validation and compatibility policy, complete editor commands and repair/undo UX, epochs/retention/compaction, production collaboration transport/presence, integrated owner/Execution lineage handling and the five-user/two-native-run journey. No additional implementation tickets are justified by this bounded experiment alone.

## Primary-source basis

Yjs maps support nested shared types and JSON-encodable values; arrays represent ordered sequences. Shared types can occupy only one location, so the selected mapping moves entity references instead of reinserting integrated node objects. This is an application design inference from the documented APIs. [Y.Map](https://docs.yjs.dev/api/shared-types/y.map), [Y.Array](https://docs.yjs.dev/api/shared-types/y.array), [shared-type caveats](https://docs.yjs.dev/getting-started/working-with-shared-types).

Yjs documents update convergence under duplicate/reordered delivery, and transactions batch observers/update emission. Those guarantees do not establish tree validity, executable order intent or rollback. [Document updates](https://docs.yjs.dev/api/document-updates), [Y.Doc](https://docs.yjs.dev/api/y.doc).

Pinned source shows nested-type deletion traversing children and integration deleting content under deleted parents. The experiment therefore keeps independent entity records/tombstones and proposal history; it does not treat hard nested deletion as a conflict audit trail. [ContentType.delete, v13.6.32](https://github.com/yjs/yjs/blob/v13.6.32/src/structs/ContentType.js#L100), [Item.integrate, v13.6.32](https://github.com/yjs/yjs/blob/v13.6.32/src/structs/Item.js#L508).
