# AWS identity connection prerequisite

Date: 2026-09-13. Decision #15 remains open.

**Superseding result:** [GitHub successfully assumed the identity-only AWS role](aws-github-connection-result.md).
The provider and probe role now exist. The earlier blockers and not-applied
statements below are historical; Ireland policy review and deployment remain pending.

The owner selected **Proof of Concept**, account `728616601473`. Actual local
`sts:GetCallerIdentity` succeeded using profile `agents-assemble`, assumed role
`AccountFullAccessRole`; `account:GetAccountInformation` confirmed the account
name and ID. This supersedes the earlier CloudShell account selection.
Local authentication is now verified. The cause of earlier browser failures is
not established by this success.

## Current permission blocker

Actual `iam:GetOpenIDConnectProvider` for
`arn:aws:iam::728616601473:oidc-provider/token.actions.githubusercontent.com`
was explicitly denied by organization service control policy `p-ie2he05n`.
`iam:GetRole` for `aa-wf15-identity-check` returned `NoSuchEntity`.
`iam:ListAccountAliases` was also explicitly denied by the same policy;
`organizations:DescribeAccount` was denied, so the account name was obtained
through the account API instead. No IAM write was attempted.

The organization administrator must review the scoped bootstrap inventory below
and permit the required operations under organization policy and the caller's
IAM permissions. Only the provider read denial is established for this inventory;
write permissions have not been tested. An
[SCP limits role permissions even when an administrative IAM policy grants access](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html).
Do not remove the provider check, replace federation with long-lived keys, or
switch accounts to work around this restriction. Keep #15 open pending access.

## Browser diagnosis: AWS-managed simplified experience

The owner requested browser operation and offered to sign in. The browser was
already authenticated to Proof of Concept. Opening Organizations displayed
“Service AWS Organizations unavailable” and “Activate advanced features to access
this service.” AWS Settings exposes an advanced activation form, currently left
open before email verification and final activation. No account setting changed.

This refines the earlier generic organization-administrator diagnosis: the
restrictions belong to AWS's simplified new-account experience. The supported
activation flow transfers organization administration to the owner. AWS documents
that [advanced activation is irreversible and removes simplified spend limits](https://docs.aws.amazon.com/accounts/latest/reference/activate-advanced-features.html).
It also enables additional services and regional controls; the Ireland target
still requires checking the effective regional policy after activation.

The form requires a team name and verified management-account email. The owner
must complete email verification in the browser. Review the actual activation
confirmation and obtain any required approval before submitting this broader
account change. Keep the existing identity source; do not change it incidentally.
No activation, organization-policy edit, provider creation, or role creation has
been performed. GitHub federation remains pending.

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
the CLI helper remains on the disposable experiment branch.

## Prepared CLI change — not applied

[Reviewed setup source](https://github.com/09millarda/agents-assemble/blob/8e3ac5017212c5f8988ca926220d2818318bf5ef/experiments/lambda-deployment/connect_identity.py)
has SHA-256 `25a03bb5a4e08edc69fee367a4e54138df9bef52a4d74a1ecf653ca3a6855d16`.
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

The bootstrap principal needs `iam:GetRole`, `iam:GetOpenIDConnectProvider`,
`iam:CreateOpenIDConnectProvider`/`iam:TagOpenIDConnectProvider` when absent,
`iam:CreateRole`/`iam:TagRole`, `iam:PutRolePolicy`, `iam:GetRolePolicy`, and
`iam:UpdateAssumeRolePolicy` for this inventory. The helper does not grant these
permissions. Failure may leave previously created resources; it prints completed
creates and stops, and never overwrites an existing role on a blind retry.

IAM and STS have [no additional service charge](https://docs.aws.amazon.com/us_en/IAM/latest/UserGuide/introduction.html).
No metered application resource is created by this setup. Plan a single connection
check within 24 hours, then remove the role. This does not approve or provision
Lambda, API Gateway, S3, deployment roles, or the later fixture budget.

## Resume and cleanup

The prior CloudShell command targeted a different account and is superseded.
Do not apply the helper while the provider read is denied. Once the organization
administrator permits the scoped setup, recheck account identity and provider
access. The local profile is `agents-assemble`; use the installed AWS CLI at
`/home/amillard98/.local/bin/aws`. The helper accepts standard `AWS_PROFILE` and
`PATH` environment settings. It checks the selected account before any mutation.

After `connection_created`, dispatch `aws-identity-check.yml` on main with
`verify_aws=true` and verify the resulting account and role. Until that succeeds,
GitHub-to-AWS authentication remains pending.

After the connection experiment, delete the `IdentityOnly` inline policy from
`aa-wf15-identity-check`, then delete that exact role using the same account and
profile. No role has been created by the agent so far.

Retain the provider if it was preexisting or has since become shared. If this
experiment created it, inventory any other role trusts before deciding to remove
it. Do not automatically delete an account-wide provider as role cleanup.

## Verification and limits

Embedded workflow Python syntax, helper Python compilation, default no-network
plan, and Git whitespace checks passed. Seven local simulated checks passed:
plan-only, wrong account, existing role, denied provider read, incompatible
provider, policy verification failure leaving trust inactive, and successful
ordering with inactive initial trust. These check local guard behavior, not AWS
IAM enforcement. The original GitHub claims run passed. The retargeted helper plan and Python
compilation passed. Local AWS identity and account name were verified, and the
provider permission blocker above was observed. AWS bootstrap, trust
enforcement, role assumption, deployment, health checks and rollback remain
unexercised by the agent.
