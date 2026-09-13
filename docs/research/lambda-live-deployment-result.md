# Actual GitHub deployment and recovery probe

Date: 2026-09-13 · [Decision #15](https://github.com/09millarda/agents-assemble/issues/15)

## Verdict

The bounded provider path passed: GitHub OIDC, exact-stack CloudFormation updates,
retained-artifact promotion, remote health failure, and restoration of the retained
healthy artifact in two disposable environments. Decision #15 stays open. This is
provider evidence, not an integrated deployment adapter or release certification.

The owner approved the described inventory in Proof of Concept (`728616601473`),
Ireland (`eu-west-1`), with a $1 planning allowance and cleanup within 24 hours.
Only the stateless test app was provisioned; no customer traffic, data or database
migration was introduced. Source and sanitized evidence are archived separately
at [c7bdb8dfeb441b457c3e065d487e2a750c3aa9cb](https://github.com/09millarda/agents-assemble/tree/c7bdb8dfeb441b457c3e065d487e2a750c3aa9cb/experiments/lambda-deployment).

## Actual runs

The repository-owned workflow at `9fae05bf9e9eec9b7c69837757cfcbf22c371aa4` fetched
the fixed disposable controller/template registry at
`749b26f` on the scratch branch. It used short-lived OIDC credentials, without
static AWS secrets. Both deployment roles trust only the observed exact repository
and main-branch subject. They cannot create IAM roles, write API Gateway resources,
delete stacks, or mutate the artifact bucket.

| GitHub run | Observation |
| --- | --- |
| [34766091078](https://github.com/09millarda/agents-assemble/actions/runs/34766091078) | First staging update stopped on a function-scoped alias permission mismatch. CloudFormation rollback also needed operator repair; this is a real failed attempt, not a passing recovery case. |
| [34766225454](https://github.com/09millarda/agents-assemble/actions/runs/34766225454) | Staging healthy release: code digest verified, HTTP 200. |
| [34766307372](https://github.com/09millarda/agents-assemble/actions/runs/34766307372) | Production-like promotion: the same S3 object version and ZIP bytes, separate environment, HTTP 200. |
| [34766308978](https://github.com/09millarda/agents-assemble/actions/runs/34766308978) | Deliberately unhealthy staging artifact: AWS update completed, endpoint returned 503, workflow correctly failed. |
| [34766374171](https://github.com/09millarda/agents-assemble/actions/runs/34766374171) | Staging restoration through CloudFormation: retained healthy artifact, digest verified, HTTP 200. |
| [34766375507](https://github.com/09millarda/agents-assemble/actions/runs/34766375507) | Deliberately unhealthy production-like artifact: AWS update completed, endpoint returned 503, workflow correctly failed. |
| [34766446905](https://github.com/09millarda/agents-assemble/actions/runs/34766446905) | Production-like restoration: retained healthy artifact, digest verified, HTTP 200. |

The six completed provider updates were independently matched to CloudFormation
stack events by their exact client request tokens. Each run recorded its account,
role, workflow revision, stack, predecessor, artifact object version/digest,
template digest, manifest digest, change-set ID, observed Lambda version/code
hash, environment and HTTP health result. A provider success with failed health
remained a failed application release.

Healthy ZIP SHA-256: `5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e`.
Unhealthy ZIP SHA-256: `fb1f9e4237d6a8643223ed8cf29e65af80733268f61397bf03684f3ce0f899fb`.
Both app artifacts were built at source revision
`3d59892ff3fc689b65e030f1c63b5706978d27b1`; the boolean health setting is compiled
into the bytes. Promotion and restoration reused the recorded object versions,
without rebuilding. Restoration published another Lambda version containing the
retained healthy artifact; it did not directly repoint the alias to the earlier
physical Lambda version outside CloudFormation.

## Setup findings and limitations

- Initial role assumption failed before stack creation. Existing resources and
  trust were reconciled before proceeding; no duplicate bucket or roles were created.
- AWS rejected the managed SAM transform even after its scoped permission was
  present. A custom-policy simulation also returned an unhelpful implicit denial
  for this AWS-owned transform, including with an unrestricted test resource.
  The cause is unresolved; no broad permission was attached as a workaround.
  Pinned local SAM translator 1.113.0 generated equivalent, inspected plain
  CloudFormation templates, each containing seven reviewed resources.
- API Gateway bootstrap required both the encoded tag-route POST permission and
  `apigateway:TagResource`. Failed stacks were allowed to roll back, recorded and
  deleted before replacement. Those API write permissions were removed before
  enabling GitHub deployment trust.
- CloudFormation's UpdateAlias request authorizes against the base function ARN.
  The initially proposed `:live`-only grant did not work for that handler. The final
  grant covers UpdateAlias on that one fixture function, with no alias-creation or
  other-function access. After correcting it, the operator continued the existing
  CloudFormation rollback; the next GitHub release used a new effect/run identity.
- The production-like operations were authorized disposable tests. No GitHub
  environment reviewer gate or durable product approval was exercised. The
  workflows are manual dispatches, not an automatic merge-to-staging implementation.
- Restoration was explicitly dispatched after the known failed-health result.
  Automatic rollback, lost dispatch acknowledgments, duplicate/reordered receipts,
  cancellation/revocation races, concurrent same-environment releases, missing
  artifacts and unknown-outcome takeover remain to test. These runs do not prove
  database recovery, full configuration drift checks, or a durable Execution adapter.

## Cost and cleanup

The $0.14 estimate deliberately excluded monthly free usage and credits. It used
a much larger bound of 10,000 requests, 100 MB logs and 100 MB artifacts; it was
not an observed charge. The live artifact inventory was four versions totaling
282,996 bytes. The agent issued eight health requests across the baseline and six
completed release probes, with no load test. CloudWatch reported zero stored bytes
at the snapshot time; that lagging field is not proof of zero ingestion charges.

IAM has no additional charge, and standard GitHub-hosted runner use is free for
this public repository. Lambda has a monthly free allowance; API Gateway, S3 and
logs have usage-based charges subject to the account's applicable free offers.
The management-account Credits page showed zero active credits and $0 remaining.
That observation does not inventory other member-account credits or establish
remaining monthly allowances. Final AWS billing was not available in this probe.
[IAM](https://aws.amazon.com/iam/faqs/),
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[Lambda](https://aws.amazon.com/lambda/pricing/),
[API Gateway](https://aws.amazon.com/api-gateway/pricing/),
[S3](https://aws.amazon.com/s3/pricing/).

Cleanup completed within the approved 24-hour window. Before deletion, the
workflow was disabled and both GitHub roles received an explicit deny policy and
expired trust. CloudFormation then used separately scoped deletion permissions.
One production-like permission removal initially failed despite the matching
cleanup policy; the operator verified the policy and retried the confirmed failed
delete without widening access. Both stacks/functions, all four artifact versions,
the bucket and six fixture roles were removed. A final API/log-group inventory
and direct bucket/role absence checks are archived in the cleanup receipt.

The existing OIDC provider and identity-only connection probe remain separately
inventoried and have no IAM fee. The identity role's trust still expires at
2026-09-14 14:52:08 UTC. The disabled probe workflow is retained as a documentary
entry point; it is not an active application deployment pipeline after cleanup.
