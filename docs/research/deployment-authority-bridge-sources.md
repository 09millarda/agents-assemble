# Deployment authority bridge: source findings

Decision: [#15](https://github.com/09millarda/agents-assemble/issues/15). Checked 2026-09-13. Primary-source research, not a claim that the proposed bridge has run.

## Recommendation

**Keep AWS credentials inside Integrations and have its trusted controller perform the operation described by the accepted manifest.** GitHub authenticates to the claim endpoint and submits an effect identifier and manifest digest. Execution retains PostgreSQL ownership of approval acceptance, one-use claim, environment generation and obligations; Integrations retains provider intents and receipts. This is an engineering recommendation, building on [ADR 0003](../architecture/0003-durable-execution-and-recovery.md), not a requirement imposed by AWS.

IAM can enforce useful resource, template-location, role and request-time boundaries. It does not directly evaluate this product's complete manifest, approval record or consumed effect. A carefully restricted execution-only session for a pre-created change set could enforce a narrower operation, but proving all bypass paths would be a separate experiment. Issuing ordinary deployment credentials after a local claim still leaves the credential holder as a trusted deployment controller.

## AWS enforcement boundaries

`AssumeRoleWithWebIdentity` defaults to one hour and accepts `DurationSeconds` from **900 seconds** to the role maximum, up to 12 hours. Its optional inline/managed session policies narrow the role's identity permissions by intersection; they cannot grant additional role permissions. Inline plus managed policy plaintext is limited to 2,048 characters, with a separate packed-size constraint. **Inference:** if the GitHub token can directly assume a broader deployment role, the workflow can omit the optional session policy; a broker-generated policy is not an enforceable approval gate against that bypass. [STS API](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html).

The session-policy intersection has an additional boundary: resource policies granting permissions directly to a session ARN can grant permissions beyond its session-policy allow set. Exact effective permissions therefore require inspecting resource policies too. [IAM session policy evaluation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#policies_session).

The 900-second minimum is **credential lifetime**, not the shortest possible permission window. `aws:CurrentTime` is always present and permits request-time comparisons; an applicable policy can stop authorizing new requests earlier. This remains distinct from completion time of an already accepted asynchronous operation. [Global condition keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-currenttime), [asynchronous change-set execution](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html).

Role permission edits affect existing temporary sessions because permissions are evaluated on each request; AWS notes propagation can take minutes. The documented revocation mechanism attaches `AWSRevokeOlderSessions`, denying sessions issued before a cutoff, and the console includes approximately 30 seconds of future issuance to accommodate propagation. It affects all matching sessions of the role. This is not an atomic revocation transaction with the product's approval row. [Disabling temporary permissions](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_control-access_disable-perms.html), [role session revocation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_revoke-sessions.html).

The official machine-readable CloudFormation reference, version `v1.4` when read, gives these relevant mappings. Its existence and interpretation are documented by AWS; the older human-readable CloudFormation service-reference URL redirected to the index during this research. [AWS programmatic service reference](https://docs.aws.amazon.com/service-authorization/latest/reference/service-reference.html), [CloudFormation JSON metadata](https://servicereference.us-east-1.amazonaws.com/v1/cloudformation/cloudformation.json).

| Action | Supported resource in this mapping | Relevant action condition keys |
| --- | --- | --- |
| `CreateChangeSet` | `stack` | `ChangeSetName`, `TemplateUrl`, `RoleArn`, `ResourceTypes`, `ImportResourceTypes`, `StackPolicyUrl`, request tags |
| `ExecuteChangeSet` | `stack` | `ChangeSetName` |
| `DescribeChangeSet`, `DeleteChangeSet` | `stack` | `ChangeSetName` |
| `UpdateStack` | `stack` | `TemplateUrl`, `RoleArn`, `ResourceTypes`, `StackPolicyUrl`, request tags |

Keys above use the `cloudformation:` prefix except AWS request-tag keys. Do not infer that `ExecuteChangeSet` accepts a change-set ARN as its IAM `Resource` merely because the API accepts that ARN as a request argument. The mapping lists a stack resource for that action. [CloudFormation JSON metadata](https://servicereference.us-east-1.amazonaws.com/v1/cloudformation/cloudformation.json).

CloudFormation's conditions compare named API parameters: `TemplateUrl` constrains the template URL, `RoleARN` the service role, and `ChangeSetName` the change set. AWS explicitly recommends making template storage read-only to those callers. `TemplateUrl` applies to create/update/create-change-set requests, not execution. [CloudFormation IAM guide](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/control-access-with-iam.html#aws-specific-keys).

`CreateChangeSet` also accepts parameter values, tags, capabilities, rollback configuration and either a template body, URL or previous template. Therefore an allowed URL alone does not prove all request inputs equal an approved manifest. The narrow fixture should use pre-expanded, version-bound templates and verify the full resolved request; any session-policy alternative must account for parameters and other mutable inputs. The latter is a recommendation. [CreateChangeSet API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html).

A CloudFormation service role supplies its own permissions for resource operations. Once associated, other callers allowed to operate on that stack can use it even without `iam:PassRole`. Thus restricting the caller's direct Lambda permissions does not restrict CloudFormation to those same Lambda permissions. Keep the service role narrowly scoped independently. [CloudFormation service role](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html).

For direct Lambda operations, current metadata gives function resources for `UpdateFunctionCode`/`UpdateAlias` and no action-specific code-digest condition; `UpdateFunctionConfiguration` lists layer/VPC/network conditions. None supplies an arbitrary approved-manifest hash comparison. [Lambda JSON metadata](https://servicereference.us-east-1.amazonaws.com/v1/lambda/lambda.json).

## Authenticating the GitHub claimant

GitHub discovery currently specifies issuer `https://token.actions.githubusercontent.com`, JWKS at `https://token.actions.githubusercontent.com/.well-known/jwks`, and `RS256`. Its advertised claims include repository/owner IDs, workflow ref/SHA, event/ref/SHA, run ID/attempt and token timestamps. GitHub permits a custom audience; the caller choosing an audience does not itself establish product approval. [Discovery metadata](https://token.actions.githubusercontent.com/.well-known/openid-configuration), [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc).

JWT verification must check the signature with keys bound to the trusted issuer, permitted algorithm, issuer, intended audience and expiry; constrain token age and validate application-specific claims. Do not choose an issuer/JWKS URL from unverified input. These requirements follow from OIDC validation and JWT security guidance. [OIDC token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html#section-3).

The npm registry and tagged source reported **jose 6.2.12** when checked. Pin that exact package with lockfile integrity for a reproducible probe. `jwtVerify` verifies signature and claims; `createRemoteJWKSet` resolves public signing keys, caches them and refreshes according to its cooldown. Its default fetch timeout is five seconds. [Tagged package](https://github.com/panva/jose/blob/v6.2.12/package.json), [jwtVerify](https://github.com/panva/jose/blob/v6.2.12/docs/jwt/verify/functions/jwtVerify.md), [remote JWKS resolver](https://github.com/panva/jose/blob/v6.2.12/docs/jwks/remote/functions/createRemoteJWKSet.md), [resolver options](https://github.com/panva/jose/blob/v6.2.12/docs/jwks/remote/interfaces/RemoteJWKSetOptions.md).

Schema-based probe guidance, not an executed validation result:

```js
import { createRemoteJWKSet, jwtVerify } from 'jose';

const keys = createRemoteJWKSet(new URL(
  'https://token.actions.githubusercontent.com/.well-known/jwks',
));
const { payload } = await jwtVerify(token, keys, {
  issuer: 'https://token.actions.githubusercontent.com',
  audience: configuredAudience,
  algorithms: ['RS256'],
  requiredClaims: ['exp', 'nbf', 'iat', 'jti', 'sub', 'repository_id',
    'repository_owner_id', 'workflow_ref', 'workflow_sha', 'event_name',
    'ref', 'sha', 'run_id', 'run_attempt'],
  maxTokenAge: '5 minutes',
  clockTolerance: 0,
});
if (payload.aud !== configuredAudience) throw Error('unexpected audience shape');
// Compare every trusted workflow/repository/run binding with server-owned state.
// Pass verified run identity to the claim owner; never trust body.run/body.attempt.
```

Five minutes and zero clock tolerance are proposed fixture settings. `requiredClaims` requires presence; it does not establish the custom claims' expected values. `audience` supports membership matching, so the explicit equality above restricts this probe to one scalar audience. The gate must separately validate claim types and exact configured bindings before calling the durable owner. [jose verification options](https://github.com/panva/jose/blob/v6.2.12/docs/jwt/verify/interfaces/JWTVerifyOptions.md), [claim verification options](https://github.com/panva/jose/blob/v6.2.12/docs/types/interfaces/JWTClaimVerificationOptions.md).

## Narrow experiment recommendation

First run the signed GitHub token through a local HTTP gate and existing PostgreSQL claim worker in a pinned trusted workflow, with no AWS permissions or calls. Exercise missing/tampered token, wrong audience, mismatched server-side workflow binding, manifest substitution, duplicate claim and post-commit lost acknowledgement. Archive allowlisted verified claims and durable outcomes, never bearer tokens. Because client, gate and database share a trusted job, this establishes real issuer/signature validation plus protocol behavior, not protection from a malicious runner or a separate-host authority boundary. Seeded approvals remain seeded.

For a later separately inventoried AWS fixture, isolate Integrations from the runner and keep credentials there. Accept only registered effect ID/digest, load the stored manifest, obtain the one-use Execution claim through an authenticated context boundary, persist possible-provider-dispatch before calling AWS, and issue the exact stored change-set request. Use one CloudFormation controller, stable create/execute request tokens, and provider queries after discarded acknowledgements; never replace an unknown effect with a fresh one. `ExecuteChangeSet` specifically supports `ClientRequestToken` for retry correlation and starts work asynchronously. [ExecuteChangeSet API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html).

Demonstrate duplicate/rerun denial, real accepted-operation/lost-response reconciliation, expiry/revocation before claim, continued reconciliation after the cutoff, and separately authorized automatic restoration after failed health. Review resource inventory, role policies, bounded lifetime and cleanup before provisioning. The controller still is trusted code: credential retention does not cryptographically prove that a compromised Integrations service obeys its manifest. Execution's durable ownership and per-context transactions remain unchanged; no generic deployment platform or alternate execution database is implied.
