# Lambda deployment identity and recovery: experiment plan

Date: 2026-09-12 · Decision [#15](https://github.com/09millarda/agents-assemble/issues/15) · Map [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Current verdict

**Bounded live deployment/promotion/restoration passed; decision open.** The owner continued with
AWS after considering Cloudflare. The agent created the reviewed identity-only
provider/role in Proof of Concept (`728616601473`), and GitHub run 34763931826
successfully assumed it. See [actual connection evidence and saved Ireland
policy amendment](aws-github-connection-result.md). The connection role grants no
deployment access. The owner-approved one-region addition is saved in the organization policy;
a subsequent Lambda read in Ireland succeeded. The [bounded bootstrap review](lambda-fixture-bootstrap-review.md)
records the owner-approved resource scope, permission boundaries, cost and cleanup.

The [live result](lambda-live-deployment-result.md) records six completed GitHub
provider updates, including the same-artifact promotion and failed-health/recovery
in both test environments, plus the initial failed attempt and operator repair.
Manual dispatch and operator-triggered restoration do not prove durable production
approval, automatic rollback, uncertain dispatch recovery or full adapter conformance.
The [dispatch and durable authority result](deployment-authority-result.md) adds three actual GitHub runs/four attempts and sixteen controlled PostgreSQL scenario groups. It validates selected claim, generation, receipt and rollback-authority rules separately from the earlier AWS operations. The live authenticated claim-to-AWS bridge and provider fault paths remain unqualified.
The broader protocol below remains an experiment input, not an accepted ADR.
They preserve the owner-approved [release contract](../first-release-contract.md)
and [Execution/Integrations ownership](../architecture/0003-durable-execution-and-recovery.md).
See the [primary-source comparison](lambda-deployment-sources.md) for provider facts
and the distinction between documented behavior and proposed adapter policy.

Historically, the initial read-only probe found no `aws` or `sam` executable, AWS environment variable,
or default AWS config/credentials file in this session. At that point the planning repository
had Actions enabled and no workflows, environments, repository secrets or
repository variables. All five GitHub metadata queries succeeded. These findings
do not inventory other repositories, organization secrets, browser sessions,
instance roles or AWS accounts; no authenticated AWS identity was established.

The [disposable recorder and sanitized snapshot](https://github.com/09millarda/agents-assemble/tree/3213e8d/experiments/lambda-deployment)
are archived separately at `3213e8d` on `codex/prototype-lambda-deployment`.
Its recorded `conformance_passed` is false. Source SHA-256:
`a44c220b3ed9433c15d57f4fad0730a9208c2fd54cf95924de5979fc48c3100c`.
Only prerequisite observations were recorded; no cloud resource was created.

## Local sign-in setup

The owner selected the profile name `agents-assemble`. AWS CLI `2.36.44` was
installed under the local user after the official installer verified its GPG
signature. The profile has region `eu-west-1` and JSON output. Browser sign-in
did not establish CLI credentials. The pending login was stopped at the owner’s
request. The owner subsequently established local credentials: STS and the account
API confirm Proof of Concept (`728616601473`). The earlier SCP-denied GitHub provider read was superseded by successful
identity bootstrap after advanced activation; see the current result above. This supersedes only the initial CLI/profile absence observation,
not the archived preflight or unexercised deployment cases.

## Required environment and bounded resource proposal

The owner selected AWS Europe (Ireland), `eu-west-1`, and the current repository,
`09millarda/agents-assemble`, for the disposable fixture. This supersedes the
earlier dedicated-repository proposal. Proof of Concept account `728616601473` is selected for bootstrap; a CLI profile is simply a locally named collection of
connection/sign-in settings and need not already exist. Record the permitted
spend/duration and resource prefix before provisioning. Account/role/profile names are metadata;
credentials must be established through the provider authentication flow,
never included in issue comments, chat or evidence archives.

Prepare a concrete resource inventory after those inputs are known: one artifact
bucket with immutable object versions and two isolated SAM stacks, each with a
small TypeScript/Hono Lambda, published versions/alias, API Gateway endpoint,
bounded log retention and health/rollback resources. Inventory SAM-generated
resources as well as explicit resources. Use a stateless fixture: no database,
irreversible migration, customer traffic, VPC or unrelated account resources.
Record actual package/tool/action versions and exact commits at execution time.

Separate the bootstrap identity from staging and production deployment roles.
The experiment must record effective IAM/OIDC trust and environment protection
settings, including any existing OIDC provider shared with unrelated projects.
Scope the fixture to its repository, account, region, stack/resource names and
artifact objects. Use temporary credentials. Do not alter a shared provider or
grant broad production access as an incidental setup shortcut. Record the exact
permissions needed by the SAM/CloudFormation service role and `PassRole` path.

Before cloud mutation, produce the actual SAM/change-set/resource and IAM
inventory for the selected sandbox, including duration, estimated cost and
cleanup procedure. The release contract places resource provisioning in later
authorized execution. No access, budget or target is inferred from GitHub admin
permission. The independent research and read-only preparation proceed now.

## Candidate release and authority records

These are proposed fields for the experiment, not a final wire encoding.
Canonical serialization and digest verification must operate on the complete
manifest; display names and caller-supplied hashes alone cannot authorize it.

| Record | Required binding |
| --- | --- |
| Release candidate | Organization/project/repository identity, source PR/head and verified merged commit, trusted build workflow path/revision, run ID and attempt, exact ZIP digest, versioned artifact object/digest, packaged SAM template digest and dependency/build-tool provenance. Production consumes these retained bytes, without a fresh application build. |
| Deployment manifest | Release candidate digest; account, region, stack and environment ID/revision; target alias; parameter/configuration digest; pinned secret version references where applicable; trusted deploy workflow and action revisions; expected prior healthy release; health and rollback policy revisions. Staging and production parameter differences are explicit and individually bound. |
| Approval | Authorized principal and policy evidence, exact production manifest digest and staging verification receipt, request/version, acceptance time, expiry, revocation/cancellation cutoff and declared rollback envelope. Human Interaction records a reply; Execution separately accepts and grants the effect. |
| Effect | Stable tenant-scoped effect ID and immutable payload digest, environment admission generation, finite authority, operation kind, expected predecessor, correlation nonce and durable state. Same ID/different payload conflicts; workflow run and rerun attempt do not replace effect identity. |
| External receipt | Verified repository/workflow/ref/run/attempt, dispatch observation, claimed manifest/effect, AWS stack/change-set/client token/deployment IDs, Lambda code/configuration/version and alias observations, health sample scope/time and rollback evidence. Provider status is evidence for a verdict, not the verdict itself. |

The first fixture should use nonsecret configuration. If a mutable secret alias
or external configuration is introduced, either bind its resolved version before
approval or explicitly define and validate a freshness policy. A stable logical
name cannot prove that staging and production used the same configuration.

## Candidate dispatch, effect and recovery protocol

1. Execution accepts an exact release/environment intent in its own transaction;
   Integrations separately persists the effect and payload. Record possible
   dispatch before the external request. Preserve one-use dispatch admission.
2. Dispatch a trusted workflow with effect/manifest identifiers. Capture the
   actual HTTP status/body/API version and returned run details where supported.
   Bind the running workflow to the expected repository, workflow revision,
   source and `run_attempt`; a title or timestamp match is not authentication.
   Protect the executor ref independently of the application source and pin
   external actions. Validate the actual OIDC subject/trust binding; a workflow
   allowed to assert its own arbitrary manifest cannot supply independent authority.
3. Require a current, effect-bound claim at the workflow's effecting boundary,
   after any environment wait and before obtaining/using deployment authority.
   Duplicate dispatch or rerun may exist remotely but cannot silently create
   another authorized mutation. A durable claim followed by an ambiguous crash
   is itself an unknown obligation; it cannot simply be reset for retry.
   Define the atomic authority-consumption point and the admitted in-flight
   window. A pre-call timestamp check cannot enforce a hard remote expiry, and
   GitHub approval or STS credential validity is not product-level revocation.
4. Serialize mutations to the exact environment against the expected predecessor.
   GitHub concurrency is an additional scheduling aid. It does not replace the
   environment owner or prove that an old process/CloudFormation operation has
   stopped. Reconcile the old operation before releasing a slot to a new effect.
5. Create a named, bound CloudFormation change set, inspect its intended changes,
   and execute under the admitted effect. Record separate create/execute tokens
   and actual query results. An uncertain API call requires authoritative query;
   a response timeout, empty run list or absence of a webhook is not proof of no
   deployment. Determine actual provider token behavior experimentally.
6. Verify deployed code/configuration, version and alias against the manifest and
   sample the intended API endpoint. Record the actual API-to-alias routing and
   time of observation. Workflow success alone is insufficient; observations
   establish health at a point in time, not permanent availability.
7. On an authorized failed-health path, create a separate linked rollback effect
   naming the failed deployment and exact retained healthy predecessor. Require
   the declared rollback authority and expected current environment. Verify
   rollback health and provider completion. Preserve original release failure
   alongside successful restoration; do not relabel it as successful delivery.
8. When provider mutation or rollback remains uncertain, retain the environment
   obligation and expose manual recovery. Cancellation closes future admission
   and requests remote cancellation/accounting; it does not assert that issued
   AWS credentials or already-started CloudFormation/CodeDeploy work stopped.
9. Integrations persists the immutable provider receipt and its outbox locally.
   Execution separately accepts or rejects that receipt against the exact effect,
   release, environment and current obligation. Redelivery repeats receipt
   acceptance, never deployment dispatch. Preserve rejected/conflicting verdicts
   and distinguish provider success from Execution's accepted delivery outcome.

The experiment must choose and validate one rollback controller. Do not race an
ad hoc Lambda alias update against SAM/CodeDeploy/CloudFormation ownership. An
automatic rollback already included in an admitted deployment is accounted as
part of that operation; a later explicit restoration needs its own bounded
effect. Code restoration cannot undo arbitrary writes or migrations.

## Required observations

Evidence is now mixed. The [live AWS report](lambda-live-deployment-result.md) and [dispatch/authority report](deployment-authority-result.md) distinguish actual provider observations from controlled process faults and seeded authority/receipts. Partial evidence does not qualify the complete row. Retain request/response metadata, owner snapshots, provider IDs and pinned source hashes; a local state machine cannot satisfy a real Lambda row.

| Case | Evidence and required interpretation | Current evidence (2026-09-13) |
| --- | --- | --- |
| Trusted build | Build the merged commit once; retain exact ZIP and packaged template. Verify versioned object and build provenance, including workflow/action revision. Reject artifact or template substitution. | Partial actual: retained source/ZIP/template/object versions verified; trusted merged CI build and substitution rejection are not integrated. |
| Automatic staging | Observe dispatch identity, stack/change-set/deployment, Lambda code/version/config, endpoint routing and healthy release receipt in the sandbox. | Partial actual: manual staging dispatch and provider verification passed; automatic trigger/admission unproved. |
| Production promotion | Accept explicit approval for the production manifest and staging receipt; deploy the same code bytes with the approved production configuration; verify endpoint/alias and code digest. | Partial actual: same stored bytes promoted; exact approval binding tested only in the controlled model. |
| Changed approved inputs | Change merged output, artifact, workflow, environment, config, target or health/rollback policy individually. A mismatched approval cannot authorize the altered deployment. | Controlled: all 21 model manifest fields substituted and rejected; live authority bridge unproved. |
| Duplicate/conflicting inputs | Repeat source events, effect dispatch and workflow rerun; submit different payload under the same effect. Retain all external runs/attempts and prove at most the admitted effect mutates. | Actual GitHub: duplicate dispatch creates two runs; rerun increments attempt. Controlled concurrent claim admits one; AWS gating unproved. |
| Lost dispatch acknowledgment | Drop a real dispatch response after request transmission. Reconcile returned/listed/workflow-attested identity; empty/inconclusive lookup remains unknown. No blind redispatch. | Actual GitHub with controlled response-body loss recovered one run without redispatch; CLI success remained visible. Network timeout/negative-query completeness unproved. |
| Claim and provider crash barriers | Stop after durable claim, before/after AWS request, and before receipt persistence. Query the original change set/stack/deployment/token. Do not equate a used claim with successful mutation or a failed job with no effect. | Controlled: durable claim survives SIGKILL and retains ownership. Actual AWS create/execute acknowledgement-loss/query recovery unproved. |
| Receipt handoff | Persist provider success in Integrations, lose delivery/acknowledgment to Execution, then redeliver the same receipt. Execution accepts once without redispatch; stale or conflicting receipts cannot complete another release/environment. Retain both context snapshots and distinct verdicts. | Controlled: separate owner commit/ack crashes and replay passed; authenticated transport and crash-atomic rejection journaling unproved. |
| Reordered/late observations | Deliver status events out of order and from an earlier attempt/release. Re-query authoritative identity/current environment; stale events cannot overwrite a newer verdict. | Controlled: stale/conflicting attempt/effect/generation receipts rejected; real delayed-provider reconciliation unproved. |
| Environment contention | Overlap two releases, include canceled/queued workflows and a lost old worker. The next effect cannot bypass an unresolved environment obligation; predecessor checks reject stale promotion/rollback. | Controlled: concurrent claims, unknown owner, stale predecessor and A-to-B-to-A generation fence passed; live overlapping provider operations unproved. |
| Approval cutoff | Expire/revoke before the environment wait completes, before effect claim, after credential issuance and after provider start. Record the actual effective cutoff and any admitted in-flight window. | Controlled: pre-claim revoke/cancel/expiry and actual PostgreSQL lock wait passed; admitted completion preserved. Live environment wait/STS/provider cutoff unproved. |
| Failed health and restoration | Deploy an intentionally unhealthy stateless build, observe failed health, execute the declared rollback, verify exact retained healthy code/configuration/routing and retain both failure and restoration receipts. | Actual AWS: failed health and explicit restoration passed in both environments. Automatic rollback and live approval envelope unproved. |
| Uncertain/failed rollback | Drop acknowledgment or deny the fixture rollback permission; reconcile or expose manual recovery. Do not deploy a different release or retry indefinitely to hide the unknown. Restore permissions only in the bounded fixture. | Controlled: uncertain rollback claim blocks successors and expired/undeclared authority is rejected. Actual denied/uncertain AWS restoration unproved. |
| Cleanup | Retain evidence, then delete only inventoried fixture resources and artifact versions. Record retained/deletion-failed resources, logs and residual costs. Cleanup success is separate from historical rollback proof. | Actual AWS: all inventoried temporary deployment resources deleted and verified. Non-deploying GitHub probe disabled; local test containers removed. |

## Resume and decision completion

The next bounded live experiment must connect authenticated claim admission to
AWS authority and reconcile the original CloudFormation operation across real
request/receipt failures. Also integrate trusted merged-build provenance,
automatic staging and explicit production approval. The earlier AWS resources
are deleted; do not re-enable their retired workflow or replay the old bootstrap
as if the fixture still existed. Prepare any new resource/authority inventory
and determine which existing owner authorization applies before provisioning.
Keep disposable implementation on the scratch branch and only the minimum
reviewed dispatch entry point on the default branch when GitHub requires it.

Resolve #15 only after the evidence supports an explicit adapter verdict and the
real deployment/health/restoration acceptance cases are established, or the owner
explicitly changes the acceptance scope. Until then keep the issue open, record current prerequisite status in the map,
and publish no accepted ADR. No speculative child decisions follow from unavailable access.
