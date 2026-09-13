# Deployment authority and dispatch recovery: bounded result

**Current status:** [Closed at owner request; temporary resources and workflows retired](deployment-local-bridge-closure.md). The findings and proposed next steps below are historical.

Date: 2026-09-13 · Decision [#15](https://github.com/09millarda/agents-assemble/issues/15) · **Decision remains open.**

The investigation now has three separate evidence sets: the [six real Lambda updates and verified cleanup](lambda-live-deployment-result.md), three new non-deploying GitHub runs with four attempts, and a PostgreSQL process-fault experiment. Together they support a more precise candidate protocol. They do **not** establish that the local approval gate controlled the real AWS deployments.

The subsequent [signed OIDC claim probe](deployment-oidc-claim-result.md) verifies actual GitHub identity before the durable gate in one trusted job. The independent AWS controller and integrated provider-fault qualification remain open.

## Actual GitHub observations

The repository-owned [minimal workflow at its executed revision](https://github.com/09millarda/agents-assemble/blob/87be475fd628e1f5bb58ce06c55e9616168679ac/.github/workflows/deployment-dispatch-probe.yml) had no token permissions, secrets, checkout/action dependencies or cloud calls. It ran only on `main` and printed allowlisted identity fields. All four attempts completed successfully. The workflow was disabled after collection; neither AWS probe was re-enabled and no AWS resources were created.

| Request | Actual observation |
| --- | --- |
| First dispatch | Returned [run 34767353281](https://github.com/09millarda/agents-assemble/actions/runs/34767353281). |
| Identical second dispatch | Returned a different [run 34767354530](https://github.com/09millarda/agents-assemble/actions/runs/34767354530), despite identical effect ID, nonce, manifest digest and ref. |
| Discarded response body | The response went directly to `/dev/null`; the collector subsequently found [run 34767355441](https://github.com/09millarda/agents-assemble/actions/runs/34767355441) through the workflow run list, then checked repository, path, revision and attempt-specific log fields. It did not redispatch this request. |
| Rerun of first dispatch | Retained run `34767353281` and source/workflow revision, increasing `run_attempt` from 1 to 2. Both attempts are archived. |

The requests explicitly used API version `2022-11-28` and `return_run_details: true`. JSON bodies were retained for the first two requests; HTTP status/headers were not captured. For the third, the CLI's successful exit was visible although the body/run details were lost. This is a **controlled response-body-loss test against real GitHub**, not an observed network timeout or proof that every uncertain dispatch is discoverable. An empty list, missing log or several candidates must still remain inconclusive. Titles and workflow-supplied inputs are correlation evidence, not product approval. See the [version-pinned primary-source audit](deployment-dispatch-recovery-sources.md).

## Controlled durable observations

The [throwaway archive](https://github.com/09millarda/agents-assemble/tree/ce97aa4582e4a3684604a36995ffb93ab5a34009/experiments/deployment-authority) uses digest-pinned PostgreSQL 17.9, separate Execution/Integrations database roles, distinct owner transactions and real worker subprocesses. Accepted approvals and AWS receipts are **fixture inputs**. Two real GitHub run IDs are imported into local callers; those callers are not authenticated GitHub jobs. The archive includes executable assertions, source hashes, compact results and compressed complete owner snapshots.

Sixteen scenario groups passed:

- Concurrent claims using the two actual run IDs admit one local claimant. The duplicate and a rerun cannot consume the same authority again. All 21 declared manifest fields are individually substituted and rejected.
- A SIGKILL after possible-dispatch commit leaves durable uncertainty. Replaying the same intent does not authorize redispatch; a changed payload under that ID is rejected and journaled.
- Expiry, revocation and cancellation before claim deny admission. A PostgreSQL lock-wait observation proves that the expiry case actually waited; database time is sampled after acquiring the environment lock. Claim time and generation are persisted with the claim/outbox.
- A SIGKILL after claim leaves the environment owned. Cancellation and worker loss do not free it. Conversely, a previously admitted effect can report completion after expiry, revocation or cancellation: no immediate remote-revocation guarantee is invented.
- Separate SIGKILLs after Integrations receipt/outbox commit and Execution receipt acceptance permit replay without redispatch. Same-ID conflicts are journaled, late observations cannot reverse success, and mismatched effect/environment/manifest/run/attempt/generation/artifact receipts are rejected.
- A separately claimed restoration must match the declared retained code object/version, template and configuration, the failed parent and its finite rollback envelope. Restoration leaves the original delivery failed. Undeclared/expired rollback authority and substituted configuration are rejected.
- An unresolved restoration blocks a newer release even after cancellation. Generation binding rejects an old approval after A → B → A; a matching artifact name alone is insufficient. Stale predecessors and independent recovery holds also deny admission.
- Database permissions prevent either owner role from reading the other context's schema.

Five worker processes were actually killed after commits. AWS mutations, provider queries, credential issuance, health observations and rollback execution were not performed by this model. The restoration cases validate admission/accounting against fabricated observations; they do not demonstrate automatic AWS rollback. The [earlier live report](lambda-live-deployment-result.md) remains the sole evidence here for actual provider effects and health samples.

Static review exposed missing generation checks, an artifact-only rollback target, absent durable conflict history/claim time, and an expiry test without an observed wait. These were corrected before the final run. The stronger wait assertion initially exposed cached PostgreSQL statistics in the test observer; clearing that snapshot made the barrier observable. These are experimental corrections, not previously proven guarantees.

The completed rejection calls retain owner journals, but rejection after transaction rollback is journaled in a separate write. A crash between those operations can lose the rejection record; crash-atomic rejection history is not qualified by this fixture. Its JSON digest routine and seeded authority are also experimental, not the production wire/authentication contract.

## Candidate protocol refinement

Retain a service-owned effect identity across GitHub runs and attempts. Consume exact approval once under the current environment lock and generation. Persist the consumed authority and unresolved environment obligation before releasing an external operation. Use the same original provider operation identity for reconciliation; never turn uncertainty into a fresh deployment by retrying a workflow.

Bind rollback to its own effect, the original failure, the retained target and finite authority. Preserve the original failed delivery when restoration succeeds. Keep independent holds and rejected/conflicting evidence. Execution accepts its own receipt verdict separately from Integrations' durable receipt/outbox. These are proposed adapter requirements extending [ADR 0003](../architecture/0003-durable-execution-and-recovery.md), not a newly accepted deployment ADR.

## Remaining qualification

1. Connect a trusted GitHub execution to an authenticated, exact-manifest claim and effect-bound AWS authority. Verify the actual cutoff after environment waits, before credentials/provider calls, and when authority is revoked or expires in flight. The old direct OIDC role trusted the workflow; it did not enforce this local gate.
2. Exercise claim/provider crash barriers against the original CloudFormation operation, including lost create/execute acknowledgments and unknown/denied restoration. Demonstrate the declared automatic rollback path and its receipt recovery without releasing an uncertain environment.
3. Integrate trusted merged-build provenance, automatic staging and explicit production approval with that path. The previous live promotion used the same retained bytes, but was manually dispatched.

This step made no AWS calls and provisioned no cloud resources. The earlier cleanup remains verified historical evidence; this step made no new AWS inventory claim. Local test containers were removed after the experiment. No issue was closed, no accepted ADR was added and no implementation tickets were manufactured from these remaining gaps.
