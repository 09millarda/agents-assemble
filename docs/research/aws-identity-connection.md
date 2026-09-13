# AWS identity connection prerequisite

Date: 2026-09-13. Decision #15 remains open.

The owner resumed AWS authentication and supplied a successful CloudShell
`GetCallerIdentity` response for account `749771281623`, assumed role
`AccountFullAccessRole`. This is owner-supplied identity evidence, not an agent-run
AWS check or proof of administrative permissions. Local browser login remains
unresolved; CloudShell supplies an alternative bootstrap route.

## Observed GitHub identity

[Actual run 34757336433, attempt 1](https://github.com/09millarda/agents-assemble/actions/runs/34757336433)
passed at workflow commit `089ce23553be8760842619673a68cde4d0746957` with
`verify_aws=false`. It requested a token and emitted only allowlisted claims.
The issuer was `https://token.actions.githubusercontent.com`, audience
`sts.amazonaws.com`, and subject:

```text
repo:09millarda@11366827/agents-assemble@1366483946:ref:refs/heads/main
```

GitHub documents the [immutable subject format](https://docs.github.com/en/actions/reference/security/oidc)
for newly created repositories. The observed subject agrees with the repository
and owner IDs returned by GitHub's repository API. Decoding claims is observation,
not JWT signature verification or successful AWS federation. No AWS request was
made by this first run. The dispatch workflow is the minimum prerequisite on main;
the CloudShell helper remains on the disposable experiment branch.

## Concrete CloudShell change

[Reviewed setup source](https://github.com/09millarda/agents-assemble/blob/c3afc197eb862815ea05d4023c0d790381904149/experiments/lambda-deployment/connect_identity.py)
has SHA-256 `4f3baf90186fa5fbe344760efd3401d1903b4d11c43b98de871c6639ff7ac887`.
Running without arguments prints a plan and makes no AWS calls. `--apply` performs
this inventory, only in the selected account:

| Resource | Behavior |
| --- | --- |
| IAM OIDC provider `token.actions.githubusercontent.com` | Read and reuse unchanged if its URL and `sts.amazonaws.com` audience match. Otherwise create only if absent. An incompatible provider or denied read stops execution. |
| IAM role `aa-wf15-identity-check` | Create only if absent. Trust matches the exact observed main-branch subject and audience, with a 24-hour expiry. No wildcard subject or production environment trust. |
| Role inline policy `IdentityOnly` | Explicitly deny every action except `sts:GetCallerIdentity`; attach no allowing or managed policy. Install and verify this deny while trust is expired, then activate trust. |

This trust admits any workflow with that main-branch subject, not exclusively one
workflow file. That scope is acceptable only for this identity-only check; it is
not a deployment authorization contract. IAM resources are global; verification
uses regional STS in Ireland. The workflow requests 15-minute credentials, while
the role maximum is one hour. Trust expiry stops new assumptions; it does not
revoke sessions already issued. No access key is persisted or sent to the owner.

[GetCallerIdentity needs no permission grant](https://docs.aws.amazon.com/cli/latest/reference/sts/get-caller-identity.html).
The [explicit deny with NotAction](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notaction.html)
excludes that operation and denies other operations. The [provider API](https://docs.aws.amazon.com/cli/latest/reference/iam/create-open-id-connect-provider.html)
can retrieve certificate thumbprints when omitted; the helper does not alter a
shared provider's certificate configuration or audiences.

The CloudShell principal needs `iam:GetRole`, `iam:GetOpenIDConnectProvider`,
`iam:CreateOpenIDConnectProvider`/`iam:TagOpenIDConnectProvider` when absent,
`iam:CreateRole`/`iam:TagRole`, `iam:PutRolePolicy`, `iam:GetRolePolicy`, and
`iam:UpdateAssumeRolePolicy` for this inventory. The helper does not grant these
permissions. Failure may leave previously created resources; it prints completed
creates and stops, and never overwrites an existing role on a blind retry.

IAM and STS have [no additional service charge](https://docs.aws.amazon.com/us_en/IAM/latest/UserGuide/introduction.html).
No metered application resource is created by this setup. Plan a single connection
check within 24 hours, then remove the role. This does not approve or provision
Lambda, API Gateway, S3, deployment roles, or the later fixture budget.

## Operator command and follow-up

Run in the already-authenticated CloudShell:

```bash
curl -fsSLo /tmp/aa-connect.py https://raw.githubusercontent.com/09millarda/agents-assemble/c3afc197eb862815ea05d4023c0d790381904149/experiments/lambda-deployment/connect_identity.py &&
python3 /tmp/aa-connect.py --apply
```

After `connection_created`, dispatch `aws-identity-check.yml` on main with
`verify_aws=true` and verify the resulting account and role. Until that succeeds,
GitHub-to-AWS authentication remains pending. No local profile is required.

Cleanup after the connection experiment, from the same account's CloudShell:

```bash
aws iam delete-role-policy --role-name aa-wf15-identity-check --policy-name IdentityOnly &&
aws iam delete-role --role-name aa-wf15-identity-check
```

Retain the provider if it was preexisting or has since become shared. If this
experiment created it, inventory any other role trusts before deciding to remove
it. Do not automatically delete an account-wide provider as role cleanup.

## Verification and limits

Embedded workflow Python syntax, helper Python compilation, default no-network
plan, and Git whitespace checks passed. Seven local simulated checks passed:
plan-only, wrong account, existing role, denied provider read, incompatible
provider, policy verification failure leaving trust inactive, and successful
ordering with inactive initial trust. These check local guard behavior, not AWS
IAM enforcement. The actual GitHub claims run passed. AWS bootstrap, trust
enforcement, role assumption, deployment, health checks and rollback remain
unexercised by the agent.
