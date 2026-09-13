# Bounded Lambda fixture: bootstrap and deployment permissions

Date: 2026-09-13 · [Decision #15](https://github.com/09millarda/agents-assemble/issues/15)

Status: primary-source design review, not deployed or a passing conformance result.
Account `728616601473`, region `eu-west-1`, repository `09millarda/agents-assemble`.
Ireland policy and GitHub identity verification are prerequisites reported by the
coordinating task; this review does not independently certify them.

## Prepared fixture and observed checks

[Disposable source at `b49d062`](https://github.com/09millarda/agents-assemble/tree/b49d062/experiments/lambda-deployment)
contains the Hono app, pinned dependency lock, reproducible ZIP builder and actual
SAM template. Node 24.21.0/npm 11.19.0 with Hono 4.13.7 and esbuild 0.28.2 built
both candidates; the real Hono Lambda adapter returned the expected 200 and 503
under local HTTP API v2 events. A second healthy build reproduced the ZIP digest.

| Candidate | ZIP SHA-256 | Bytes |
| --- | --- | --- |
| Healthy | `119c810e458063cb4039c4a6e7f3b7a59545da044295d180170d38361a4513c5` | 70,748 |
| Deliberately unhealthy | `c1e7fdd2398dfb4550edfbf19ad3e564942d62bfdfa15bc892e7974ae4cd932c` | 70,750 |

Local SAM translator 1.113.0 expanded placeholder artifact parameters into seven
resources per environment: log group, Lambda function/version/alias/invocation
permission, HTTP API and stage. Inspection confirmed the generated integration
invokes the alias, the permission names the API and GET /health route, no IAM or
CodeDeploy resources are generated, and versions use `DeletionPolicy: Retain`.
The template fixes 128 MB, three seconds, one-day logs, burst two/rate one API
throttling, exact fixture bucket, and content-addressed versioned object inputs.

AWS `ValidateTemplate` did not run successfully: the local sign-in refresh failed
with an expired/invalid authorization-grant error. Refresh the existing profile
through browser login before cloud work. Local transformation does not prove AWS
handler permissions, deployment, health over the network, promotion or rollback.
Actual processed change sets and effective scoped roles still need verification
before executing deployments. No application resources were provisioned.

## Recommendation

Bootstrap the fixed infrastructure with the locally authenticated owner, then
allow GitHub only to update the two existing application stacks. Use one narrow
CloudFormation execution role per environment. GitHub should receive neither IAM
administration nor API Gateway management writes. Keep the HTTP API integration
pointing at the stable `live` alias; code releases then need no API reconfiguration.
Use CloudFormation as the sole alias/rollback controller, restoring the retained
healthy artifact through another stack update. Omit SAM `DeploymentPreference`
and CodeDeploy from this smallest experiment.

This is an experiment-design choice. It narrows the fixture to stateless code and
configuration changes; changes to networking, IAM, logging destinations or API
wiring require an independently reviewed bootstrap update. An accepted deployment
role can still run arbitrary code under the fixture's runtime role, so that role
must have only permission to write its own logs.

## Proposed inventory

| Scope | Resources |
| --- | --- |
| Shared bootstrap | One private S3 artifact bucket, suggested `aa-wf15-728616601473-eu-west-1-artifacts`; versioning, public-access block, bucket-owner-enforced ownership and SSE-S3. Existing GitHub OIDC provider reused without modifying unrelated trust. |
| IAM | Two Lambda runtime roles, two CloudFormation execution roles, two GitHub deployment roles. Use distinct `aa-wf15-staging-*` and `aa-wf15-prod-*` names. Identity-only connection role remains separately inventoried until cleaned up. |
| Each of two stacks | `aa-wf15-staging` / `aa-wf15-prod`: one named Hono Lambda (`nodejs22.x`, x86, 128 MB, 3-second timeout), published version(s), alias `live`, explicit HTTP API and `$default` stage, alias invocation permission restricted to that API, explicit Lambda log group with one-day retention. Explicit HTTP integration/routes may be generated inside the API definition rather than separate stack resources; inventory the processed template and actual API resources. |
| Exclusions | No database, secrets, custom domain, VPC/NAT, provisioned concurrency, scheduler, X-Ray, alarms, CodeDeploy, production users or customer data. |

Provide the function's explicit `Role` so SAM does not create an IAM role. SAM
`AutoPublishAlias` generates a Lambda version and alias; `DeploymentPreference`
adds CodeDeploy resources and may add another role. These facts make inspection
of the processed template necessary, not just inspection of the SAM source.
[AWS generated-resource reference](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-specification-generated-resources-function.html).

## Verified permission facts

CloudFormation reuses its attached service role for subsequent stack operations.
A caller authorized on that stack can exercise the role without independently
holding `iam:PassRole`. The execution role is therefore a privilege boundary;
removing `PassRole` from GitHub alone does not make a broad execution role safe.
Do not attach an administrator role to either stack.
[AWS service-role behavior](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html).

CloudFormation change-set operations authorize against the stack resource;
`CreateChangeSet` supports condition keys including role ARN, template URL and
change-set name. Use the actual existing stack ARN, including its unique ID,
not `stack/*`. Action-specific supported resource/condition lists matter: a
change-set ARN alone is not a substitute for stack authorization.
[CloudFormation authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudformation.html).

API Gateway V2 management uses `apigateway` actions, not `apigatewayv2` actions.
Existing APIs/subresources use `arn:aws:apigateway:eu-west-1::/apis/ACTUAL_ID...`.
Creation initially addresses a collection and cannot be constrained to a not-yet
known generated API ID; this is why broad create permissions remain in bootstrap.
[AWS API Gateway V2 authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_apigatewayv2.html).

CloudFormation updates Lambda configuration and code separately. Alias routing
to a published version avoids serving the transient `$LATEST` intermediate
state. Stack tagging may need Lambda tag/untag/list-tag permissions.
[CloudFormation Lambda reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-function.html).

## Candidate policies to validate against the actual template

These are action candidates, not a tested complete policy. Read the public
CloudFormation resource type schemas' handler permissions and inspect denied API
calls during the bounded experiment. Add a demonstrated scoped permission only;
do not respond to a denial with a managed administrator policy.

| Identity | Proposed access |
| --- | --- |
| Lambda runtime, each environment | Trust `lambda.amazonaws.com`; `logs:CreateLogStream`, `logs:PutLogEvents` only under its existing `/aws/lambda/aa-wf15-ENV` log group. No log-group creation or other AWS data access. |
| CloudFormation executor, each environment | Trust `cloudformation.amazonaws.com`. Function-specific `GetFunction`, `GetFunctionConfiguration`, `GetRuntimeManagementConfig`, `ListTags`, `ListVersionsByFunction`, `UpdateFunctionCode`, `UpdateFunctionConfiguration`, `PublishVersion`, `TagResource`, `UntagResource`; alias-specific `GetAlias`, `UpdateAlias` and version/alias reads as needed. Scope version deletion to qualified version resources if SAM removes old versions; deny unqualified function deletion to the deployment role. Retain required healthy predecessor versions explicitly. |
| Executor artifact and role access | `s3:GetObject`, `s3:GetObjectVersion` on the fixture artifact prefix. At most `iam:PassRole` on its exact precreated Lambda runtime role with `iam:PassedToService=lambda.amazonaws.com`, because configuration updates can pass that role. No IAM create/update/delete policy or role actions. |
| Executor static infrastructure reads | `apigateway:GET` only exact API ARN and its children if handler reads require it. Log read/describe permissions only as demonstrated; some collection reads require `Resource:*`, which must be isolated as read-only. No API writes or log-retention changes in the code-release policy. |
| GitHub deployer, each environment | Exact existing stack ARN: `CreateChangeSet`, `DescribeChangeSet`, `ExecuteChangeSet`, `DeleteChangeSet`, `DescribeStacks`, `DescribeStackEvents`, `DescribeStackResources`, `ListStackResources`, `ListChangeSets`, `GetTemplate`; stack tag actions only if used. No `CreateStack`, `DeleteStack`, `SetStackPolicy`, IAM actions or direct Lambda/API mutations. Omit `RoleARN` on normal calls to reuse the established narrow service role. |
| GitHub build/artifact handling | Staging/build can `PutObject` into content-addressed fixture keys; promotion gets read-only object-version access. Neither gets `DeleteObjectVersion`, bucket-policy/versioning changes or writes to other buckets. `GetBucketLocation` and narrowly prefixed `ListBucket` only if the selected upload code needs them. |
| Evidence reader | Exact function/version/alias and API reads to verify code digest, routing and health. It may be included in the same environment deployer, without adding mutation permissions. |

The exact function ARN is `arn:aws:lambda:eu-west-1:728616601473:function:aa-wf15-ENV`;
qualified versions and aliases append `:QUALIFIER`. Use the action/resource mapping
rather than blindly appending `:*` to every statement.
[Lambda authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lambda.html).

Bootstrap first with the local identity and no GitHub deployment grant. Attach
and verify narrow executor policies before enabling GitHub deployment trust. If
initial provisioning uses a temporary broader executor, remove its creation/API
write permissions before granting GitHub access; verify the resulting effective
policy. Cleanup uses a separate local bootstrap action, since deployment roles
cannot delete infrastructure. No automatic policy widening on bootstrap retry.

Versioning makes each S3 version's bytes stable but does not stop authorized
version deletion. Record `Bucket`, `Key`, `VersionId` and SHA-256 in the release
manifest; deny the CI identities deletion of versions and mutation of bucket
controls. This is retention against CI mutation, not regulatory Object Lock.
[AWS S3 versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html).

## Cost and duration estimate

Proposed owner authorization: provision and test this inventory in Proof of Concept
with a $1 planning envelope, then clean up within 24 hours. This budget has not yet
been approved. Stop issuing new test requests at the experiment bounds or on
unexpected resources/cost; do not widen policy scope automatically.

Opinion: keep the live experiment within 24 hours, at most 10,000 total requests,
100 MB of logs, 100 MB of versioned artifacts, 1,000 S3 writes and 10,000 S3 reads.
Assume every Lambda call takes the full three-second timeout at 128 MB and count
all retained S3 versions. This yields roughly $0.14 before transfer, taxes and
GitHub Actions usage; allow $1 as a planning envelope, not a provider-enforced
cap. Public traffic or a runaway loop can exceed it. Use low API throttles,
bounded scripts and cleanup; throttles are not a hard financial cap. Free-tier
credits are excluded from this estimate.

Verified Ireland rates from AWS's regional price-list JSON, publication
2026-09-11 (retrieved 2026-09-13):

| Meter | Rate, USD | Estimate |
| --- | --- | --- |
| Lambda x86 duration | 0.0000166667 / GB-second | 10,000 × 3 × 0.125 → $0.0625 |
| Lambda requests | 0.20 / million | $0.002 |
| HTTP API requests | 1.11 / million | $0.0111 |
| Logs ingestion | 0.57 / GB | $0.057 |
| Logs storage | 0.03 / GB-month | Under $0.001 for this volume and short retention |
| S3 Standard storage | 0.023 / GB-month | Under $0.001 for 100 MB / one day |
| S3 writes / reads | 0.005 / 1,000 writes; 0.0004 / 1,000 reads | $0.009 |

Sources: [Lambda price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/eu-west-1/index.json),
[API Gateway price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/eu-west-1/index.json),
[CloudWatch price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/eu-west-1/index.json),
[S3 price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/eu-west-1/index.json).

Preserve sanitized evidence, delete both stacks with the local cleanup identity,
then enumerate/delete all artifact object versions and delete markers before
removing the bucket. Remove the six fixture roles after their dependent stacks;
retain a shared OIDC provider. Report orphaned retained versions/log groups and
failed deletions explicitly. This review grants no budget and proves none of
#15's deployment, promotion or recovery cases.
