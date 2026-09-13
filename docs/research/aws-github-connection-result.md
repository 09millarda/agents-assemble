# GitHub to AWS identity: actual result

Date: 2026-09-13. Decision #15 remains open. The owner returned to the AWS/GitHub
deployment investigation after considering Cloudflare; no Cloudflare migration
was applied.

## Passing connection

AWS Settings visibly reports advanced activation complete. The agent refreshed
the existing `agents-assemble` CLI login and verified Proof of Concept,
account `728616601473`. The previously denied GitHub-provider read now returned
`NoSuchEntity`, as did the proposed role read.

The agent ran the reviewed helper at
[`8e3ac5017212c5f8988ca926220d2818318bf5ef`](https://github.com/09millarda/agents-assemble/blob/8e3ac5017212c5f8988ca926220d2818318bf5ef/experiments/lambda-deployment/connect_identity.py).
It created the account's `token.actions.githubusercontent.com` IAM OIDC provider
and `aa-wf15-identity-check` role. The `IdentityOnly` inline policy was read back
and matched the explicit deny of all actions except `sts:GetCallerIdentity`.
The role has no attached managed policies. Trust matches the observed exact
repository/main-branch subject and audience; it expires at
**2026-09-14 14:52:08 UTC**. This is a temporary identity probe, not a deployment role.

[GitHub run 34763931826, attempt 1](https://github.com/09millarda/agents-assemble/actions/runs/34763931826)
passed with `verify_aws=true` at workflow commit
`a1cb3389a152b7134af785009c029fb555b5f281`. GitHub obtained temporary AWS credentials
and `GetCallerIdentity` returned account `728616601473`, role session
`aa-wf15-identity-check/github-34763931826`. Tokens and secret keys were not
printed or committed. This proves this OIDC connection at the observation time;
it does not prove Lambda deployment, production approval, recovery or rollback.

## Ireland amendment saved and verified

An actual `lambda:ListFunctions` request in `eu-west-1` was explicitly denied by
SCP `p-kkji3i99`. In the management-account console, this is customer-managed
`AdvancedModeRegionRestrictionSecurityControlPolicy`, attached to root `r-620v`.
Its `RegionFloor` statement omitted Ireland from the region exceptions.

The owner approved the amendment in chat. The agent saved the policy with exactly
one semantic change: append `eu-west-1` to
`Statement[Sid=RegionFloor].Condition.StringNotEquals[aws:RequestedRegion]`.
The previous list was `eu-north-1`, `unspecified`, `us-east-1`, `us-west-2`.
The other statements, actions, and exceptions are unchanged. The staged editor
was copied back and parsed to verify equality with the intended policy before saving.
The minified document is 5,100 characters (original 5,088).

This is an organization-root policy amendment, **not an account-only exception**.
It removes this region denial for the current member accounts, Proof of Concept
and Identity Delegated Admin, as well as future member accounts inheriting it.
Other permission policies still apply; the management account is not restricted
by SCPs. See [AWS's SCP scope and permission rules](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html).

The editor reported `Invalid Service In Action` for `builderid:*`, an entry already
present in the original AWS-created policy. That entry was preserved. AWS accepted
the save and displayed a successful-update confirmation; the saved policy content
contained the Ireland addition. A subsequent `lambda list-functions --max-items 1`
from profile `agents-assemble` in `eu-west-1` succeeded and returned zero functions.
This verifies that operation after the amendment, not every deployment permission.

## Remaining work and cleanup

The [bounded fixture review](lambda-fixture-bootstrap-review.md) records the
proposed Hono/SAM resources, role boundaries, artifact storage, cost, lifetime and
cleanup. Application provisioning and deployment permission grants remain pending. The identity-only role cannot deploy resources.
The prepared fixture passed local healthy/unhealthy adapter and reproducible-ZIP
checks; all real application deployment/health/rollback acceptance cases remain open.
The local CLI login expired during a later template-validation attempt and must
be refreshed before cloud work; that does not negate the earlier Ireland read.

The created role and provider now exist and require accounting. Delete the
`IdentityOnly` inline policy and the exact probe role after the connection check
is no longer needed. Trust expiry does not delete the role or revoke sessions
already issued. The provider was created for this experiment; before deleting it,
check whether later deployment roles or other integrations now reference it.
Do not rerun the create-only helper against the existing role.
