# Candidate authenticated deployment bridge

**Current status:** [Closed at owner request; temporary resources and workflows retired](deployment-local-bridge-closure.md). The findings and proposed next steps below are historical.

Decision [#15](https://github.com/09millarda/agents-assemble/issues/15), 2026-09-13. **Proposed experiment contract, not an accepted ADR or deployed service.** The [source audit](deployment-authority-bridge-sources.md) explains the AWS and GitHub enforcement boundaries. The [signed-token result](deployment-oidc-claim-result.md) validates one smaller part of this proposal.

## Selected direction for the next experiment

Keep AWS credentials in a trusted Integrations controller that is separated from the GitHub runner. GitHub asks it to perform a registered effect; the controller loads the accepted manifest and constructs the exact AWS request. The runner receives status and receipts, never general deployment credentials. The direct GitHub-to-deployment-role trust used by the retired fixture must not remain as an alternate route around this gate.

This keeps the user-facing GitHub workflow as the deployment entry point and preserves Execution's PostgreSQL ownership. It changes where the trusted AWS request is made. A compromised controller remains a trusted-computing-base failure; credential retention does not cryptographically force that controller to obey its manifest. IAM still bounds its possible damage independently.

Ordinary STS credentials handed to a job after a claim leave that job trusted to obey the manifest. Session policies, named change-set restrictions, immutable template URLs and request-time conditions can help, but neither the session-policy argument nor the complete deployment manifest is an intrinsic one-use AWS authorization object. An execution-only session for a separately prepared change set is a possible narrower alternative; it has not been qualified and is not the selected next experiment. [AWS enforcement analysis](deployment-authority-bridge-sources.md#aws-enforcement-boundaries).

## Authority and transport

| Boundary | Trusted input and durable result |
| --- | --- |
| Human Interaction → Execution | Authenticated response naming the current request/version, production manifest, staging receipt and rollback envelope. Execution independently accepts it and persists finite authority; no seed masquerades as this integration. |
| GitHub → claim endpoint | Signed token verified against fixed GitHub issuer/JWKS, exact configured audience, permitted algorithm/time, repository/owner IDs, event/ref and approved workflow revision. Body contains only effect ID and manifest digest. Run ID/attempt come from verified claims. |
| Dispatch correlation → Execution | Authenticated observation of the expected workflow run/attempt for this effect. Candidate discovery may use a nonce/title; admission must bind authoritative GitHub metadata and the effect-specific dispatch registry. A globally trusted workflow cannot claim any unrelated effect merely by learning its ID/digest. |
| Execution claim | Lock current environment/effect, check complete manifest, generation, predecessor, current authority and expiry using database time after lock. Consume once and commit immutable permit, claim time, obligation and outbox. |
| Execution → Integrations | Authenticated context boundary accepts the immutable permit into Integrations' own inbox/intent transaction. This is a separate commit, even when both contexts share a database host. |
| Integrations → AWS | Persist possible provider dispatch before making the exact stored request. Retain separate create/execute identities, immutable request digest, stack/change-set identity and provider evidence. Never accept caller-supplied templates, parameters, role ARNs or replacement operation identities. |
| Integrations → Execution | Receipt and outbox commit locally; Execution separately accepts against the effect/manifest/environment/generation. Redelivery cannot issue another AWS request. |

The live OIDC probe uses a probe-wide expected run and seeded authority; it does not implement the effect-specific dispatch registry or authenticated Human Interaction handoff above. A deployment manifest must bind the approved workflow revision as well as code, immutable object version, template, configuration, environment and policy. Global authentication alone does not supply that binding.

## Cutoff and uncertain outcomes

The product cutoff is the committed claim/permit admission. A revocation or cancellation accepted before that point denies new authority. Afterwards, the already admitted finite operation is accounted as in flight. Integrations separately checks permit scope/deadline before its local admission and provider dispatch. A delayed revocation message does not retroactively change a committed permit. State the resulting window explicitly rather than promising instant cross-context revocation.

JWT verification happens at request authentication. The current probe does not test expiration during a subsequent body read or database wait. The live bridge must either carry the verified authentication deadline into the locked admission check or explicitly specify and validate an earlier authenticated-request acceptance boundary. Do not silently conflate token validity, approval expiry, permit expiry and AWS credential validity.

STS web-identity credentials have a 900-second minimum lifetime. An applicable `aws:CurrentTime` condition can impose an earlier permission deadline for new AWS requests. It does not stop an already accepted CloudFormation operation. IAM revocation has propagation delay. Keep reconciliation/read authority available after mutation authority closes; neither a timed-out HTTP request nor a cancelled GitHub job establishes that AWS stopped. [Source findings](deployment-authority-bridge-sources.md#aws-enforcement-boundaries).

An ambiguous claim response returns an unknown outcome and a read-only status/reconciliation path. It must not be presented as an ordinary invalid request or a safe retry. The throwaway HTTP probe's generic error path is not this production protocol. The recorded original effect and environment obligation remain authoritative.

Use one CloudFormation controller. For an uncertain create or execute response, query the original named change set/stack and request-token history. A missing result at one instant is not conclusive absence. Release the environment only after an accepted terminal receipt or a specifically proven no-effect outcome; otherwise preserve manual recovery. This experiment still needs actual provider fault evidence to establish any replay rule.

Rollback is a separate linked effect when initiated after the original operation. It names the failed release, exact retained healthy code/object/template/configuration, expected current generation and finite rollback authority. A successful restoration leaves the original delivery failed. Unknown restoration retains the obligation. This remains a stateless fixture; code restoration cannot undo external writes or database migrations.

## Inventory required before another live AWS run

The previous fixture is deleted. Do not replay its resource IDs or enable its retired workflow. Preserve its known permission corrections and cleanup observations as inputs to a fresh, reviewable inventory.

| Item | Required boundary |
| --- | --- |
| Trusted HTTPS gateway/controller host | Separate from GitHub runner; authenticated claim/status interface only. Select a concrete host, certificate/endpoint and cost before provisioning. The same-job probe does not supply this separation. |
| PostgreSQL persistence | Execution and Integrations own separate roles, inboxes/outboxes and recovery records. Survive controller restart; no replacement DynamoDB/workflow-service authority. |
| Controller credentials | Dedicated narrowly scoped fixture identity; no deployment-role trust reachable directly by the ordinary GitHub caller. Credentials never returned in responses, logs or evidence. |
| AWS workload | Fresh isolated staging and production-like Lambda/API Gateway stacks, immutable artifact versions and bounded logs, reusing the reviewed stateless scope. Exact IDs, duration, cleanup owner and estimated spend must be recorded. |
| CloudFormation permissions | Scope each API to its documented stack resource and supported conditions. Constrain service-role permissions separately; allowed stack operations can use the associated service role without a fresh `PassRole` grant. |
| Evidence/cleanup | Retain sanitized request identities, owner snapshots, provider events and before/after health samples. Delete only inventoried resources; account explicitly for retained logs, artifacts, roles and gateway persistence. |

The [candidate host assessment](deployment-bridge-host-feasibility.md) now identifies one temporary Ireland t3.micro with PostgreSQL, SSM administration and pinned HTTPS as a feasible direction to investigate. Read-only account checks found an existing default VPC/public subnet and AMI candidate; the two-hour host baseline is about $0.035 before tax, transfer and other resources. Preserve unresolved recovery state before deleting that host.

This inventory is a design requirement, **not a completed provisioning review**: the actual endpoint/certificate, complete policies, AMI/storage compatibility, process credential separation, measured capacity and verified stop/cleanup implementation remain to prepare. The earlier $1/24-hour permission applied to the completed bounded fixture and is not silently expanded to new persistent hosting.

## Live fault sequence to qualify

1. Produce a trusted immutable merged build and automatic staging effect; bind its verified receipt to explicit production approval.
2. Authenticate GitHub to the separate gate. Deny wrong execution/effect binding, changed manifest, revoked/expired authority and duplicate/rerun claims before any new AWS mutation.
3. Kill the controller after claim and at possible-create/possible-execute barriers. Discard actual accepted AWS response details. Restart and reconcile the original operation; retain uncertainty when lookup is inconclusive.
4. Deploy deliberately unhealthy stateless code, create the separately authorized restoration automatically, and verify retained artifact/configuration/routing and both receipts.
5. Interrupt or deny restoration and prove that a newer deployment cannot bypass the unresolved environment. Reconcile through the declared read path rather than indefinitely retrying mutation.
6. Lose receipt delivery/acknowledgment across the context boundary and verify acceptance once without redispatch. Verify cleanup independently.

Publish an accepted adapter decision only after evidence supports that contract. Current source reasoning, real issuer verification, local durable tests and earlier actual AWS operations remain distinct evidence classes.
