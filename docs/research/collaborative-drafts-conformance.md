# Collaborative drafts and revision submission: bounded conformance

Date: 2026-09-12. Decision [#12](https://github.com/09millarda/agents-assemble/issues/12), canonical map [#1](https://github.com/09millarda/agents-assemble/issues/1).

## Verdict

Select the bounded Yjs draft/durable-ingestion/exact-review-candidate profile in [ADR 0007](../architecture/0007-collaborative-drafts-and-revision-submission.md). Explicit submission advances an immutable revision head through an owner-local transaction. Execution observes that proposal separately; a draft edit or source receipt cannot change its pinned manifest or establish a stopped writer.

The final experiment passed **31 scenarios and 121 assertions**. A separate independent in-memory review passed **eight assertions** after correcting four identified protocol defects. These counts do not certify the full grammar/editor, production collaboration transport, authorization or release journey.

## Reproduction and evidence

The [complete disposable archive](https://github.com/09millarda/agents-assemble/tree/5bc9c52ce0675f49d961ee2489f175712beba389/experiments/collaborative-drafts) is committed separately at `5bc9c52ce0675f49d961ee2489f175712beba389` on `codex/prototype-collaborative-drafts`. No experiment code is merged into main.

With Node 24/npm and Docker, check out that scratch branch and run:

```sh
cd experiments/collaborative-drafts
bash run.sh
```

This installs locked Yjs 13.6.32 and pg 8.23.0, starts its own disposable PostgreSQL 17.9 container on loopback, runs the experiment, writes evidence and builds the single-file HTML lab, then removes its container/data. PostgreSQL image digest: `sha256:2a0d0fe14825b0939f78a8cad5cd4e6aa68bf94d0e5dd96e24b6d23af4315545`. These are experiment inputs, not production dependency, supported-version or licensing decisions.

| Artifact | Evidence |
| --- | --- |
| `results.json`, `latest-run.log` | Every final scenario, assertion count, duration and fingerprints for model/worker/driver/lockfile. Source hashes are captured before execution and checked unchanged afterward. |
| `traces.json` | Complete captured Knowledge, Catalog and Execution state/inbox records after each scenario, including accepted update bytes, attributed envelopes, preview content, immutable revisions and source outbox. |
| `load-measurements.json` | Raw workload latency samples, disconnect duration and transport assumptions. |
| `independent-review.mjs`, results/report/output | Separate in-memory probes, initial defects, corrections, eight passing assertions and stable model fingerprint. |
| `collaborative-drafts.throwaway.html` | Standalone guided/free-play illustration and separate recorded-evidence viewer with complete captured state. Browser inspection verified exact-preview submission despite continued editing, stale-answer rejection after retain and layout. |

The independent model hash matches the main run: `4276b19a96a3e2e4dd5d08f482a7d51401c8604c4b07e319543a5a4a486199e5`.

## What was exercised

| Boundary | Observed outcome |
| --- | --- |
| Concurrent Markdown | Two independent Yjs documents make concurrent insertions through separate HTTP requests and converge after accepted-state exchange. Both inserted runs and attributed ingress envelopes survive. |
| Deletion identity | A deletion changes materialized content/digest while leaving its Yjs state vector equal. The vector is insufficient for exact approved content. |
| Edit durability | Exact retries replay the prior receipt; different bytes or actor under the same ID conflict. A killed worker and restarted PostgreSQL retain acknowledged bytes/sequence. SIGKILL before commit rolls back; after commit, a lost acknowledgment replays without another accepted edit. |
| Pending dependencies | An out-of-order insertion update is durably retained across worker restart, but preview stays blocked until its dependency integrates. The independent probe adds a delete-set-only update before insertion, persisted-model reconstruction and eventual empty-text convergence. |
| Exact submission | A review candidate survives continued editing. Submission uses its original bytes/digest. Same-ID replay returns the existing revision; different commands against one predecessor head produce one winner and a visible conflict, retaining both candidates. Lost acknowledgment retains the revision and its source event together. |
| Graph draft/publication | Independent graph records converge. Orphan/dangling references, malformed call action values and unknown fixture behavioral fields cannot publish or change the previous version. Same-property writes converge to one winner while both accepted envelopes remain in history. |
| Human/agent proposals | A stale exact-base agent replacement becomes a retained conflict and cannot overwrite newer human content. A current-base proposal integrates; concurrent human/agent commands serialize through the source transaction lock. |
| Ownership and attribution | Fixture allowlist rejection cannot alter canonical state; receipt replay cannot change actor. PostgreSQL roles deny Execution writes to Knowledge. Owner-qualified events prevent Catalog/Knowledge source aliasing. These are bounded fixture observations, not production authentication or tenant isolation. |
| Observation | Source submission leaves a run unchanged until separate Execution acceptance. Observation preserves the pinned manifest, pauses dependent work and invalidates an unresolved wait. Future events create a gap; later gap repair advances the pending proposal without regression. Duplicates and conflicting event content have explicit verdicts. |
| Decisions and approvals | An old answer cannot approve after observation or answer a replacement wait. A second submitted revision makes an in-flight retain decision stale. Retaining an already-approved unchanged scope preserves that resolved gate without manufacturing another wait. |
| Adoption | Separate controlled writer/effect/checkpoint obligations block adoption. New bounded admission is required; the reduced successor starts at entry, inherits delivery identity and copies no approvals. A superseded predecessor cannot reopen or create another successor. |

Draft ingestion uses actual Yjs binary updates; the worker reconstructs its document from persisted state per request. PostgreSQL stores owner-local JSON aggregates and inboxes under separate roles. Submission outbox entries reside in the same owner record transaction. This is a reduced persistence shape, not the product's schema.

Source event delivery is controlled injection by the driver, not a production outbox relay. Human wait and approval acceptance occur in the reduced Execution record; a complete Human Interaction saga and invocation accounting are not implemented. Recovery/checkpoint/admission facts are explicitly trusted fixture inputs, not real harness or publication evidence.

## Qualification workload and limits

The recorded workload uses five independent Yjs replicas, an initial **51,200-byte Markdown document**, **100 flat call nodes** and **two reduced Execution run records**. Four connected replicas generate 16 edit/propagation samples while the fifth is disconnected for **60,008 ms**. Every request and response is delayed by an artificial 50 ms on the driver, using real loopback HTTP and full-state pulls. Reconnect uploads the fifth replica's previously unacknowledged edit, then synchronizes all five; all acknowledged insertions remain visible.

| Measurement | Recorded value | Interpretation |
| --- | --- | --- |
| Connected edit/propagation p95 | 848.80 ms, 16 samples | Local client-edit through server acceptance and connected replica pull synchronization; artificial delay, no real WAN or browser rendering. |
| Reconnect convergence | 681.45 ms | All five replicas converge after the 60-second disconnection in this fixture. |
| Release targets | p95 ≤2 s; reconnect ≤10 s | The local numbers meet those thresholds for this reduced workload only. |

The full release requires five actual collaborators, two simultaneous native feature runs, browser editing/presence/output, defined real network conditions and the complete delivery journey. Neither the two reduced run records nor the artificial delay establishes that qualification. Sixteen samples provide a bounded observation, not a capacity estimate, SLA or general tail-latency guarantee.

## Initial failures and corrections

Independent review found and verified corrections for four protocol defects:

- A late event could reopen a superseded predecessor and allow a second successor. Terminal-state mutation guards now preserve the existing successor and record rejected commands in the inbox.
- Event source IDs omitted context ownership. Events now distinguish owner/document; production additionally requires tenant/epoch scope.
- Retain always created a new approval wait, including an already resolved gate. Resolved state is now distinct from invalidation, and only unresolved waits are replaced.
- The reduced graph validator accepted object-valued actions and unknown node behavior. Its flat call schema now rejects both; this does not make it the full ADR 0002 validator.

Two harness issues were also corrected: PostgreSQL readiness now checks its final TCP listener rather than the transient initialization socket, and database restart rediscovers Docker's dynamically assigned loopback port. An intermediate run was discarded after source edits. The reported run completed with stable pre/post fingerprints and matching independent model evidence.

## Remaining decisions and production work

The subsequent decision is [#16, semantic graph collaboration and lossless authoring round trips](https://github.com/09millarda/agents-assemble/issues/16), dependent on #12. The flat fixture cannot decide nested shared-field representation, concurrent parent/move semantics, bindings/scopes, complete grammar validation or visual/JSON/TypeScript preservation. The later [ADR 0008](../architecture/0008-semantic-graph-collaboration.md) records its bounded representation selection and [separate evidence](semantic-graph-conformance.md); this original flat fixture remains limited to the scope described above.

Production transport/presence, browser-local pending persistence, tenant/epoch authorization and revocation, canonicalization/signature compatibility, full manifest validation, durable history/compaction/retention, actual source relay and admission cursors, multi-source proposal manifests, current-lineage subscription transfer, Human Interaction integration, HA and the complete native-run journey remain unproved. A receipt's historical integration flag is immutable; current readiness needs a covering accepted snapshot/status. Imported/replayed CRDT structures must not be relabeled as the sender's original work.

Primary-source context and the rejected/retained alternatives are in the [two-profile comparison](collaboration-substrate-comparison.md). The architecture decision draws on those sources plus the separately archived experiment; no library documentation is treated as proof of product durability or release readiness.
