# Environment delivery to local and customer-operated runners

Date: 2026-09-12  
Status: Research and architecture proposal supporting Wayfinder decision #2; no implementation or independent provider-selection decision.  
Scope: Recreate a project's environment on another authorized runner and distribute configuration changes without signing into every machine.

## Summary

Use a versioned **Environment Profile** containing ordinary configuration, logical secret references, and delivery rules. The control plane stores this profile and execution provenance. A runner resolves the required secret values directly from an authorized provider immediately before launching a process. AWS Secrets Manager and OpenBao demonstrate that this interface can work across managed and self-hosted deployments. Their authentication, expiry, and rotation semantics must remain explicit rather than being hidden behind a misleading uniform guarantee.

The profile is portable; authorization is deliberately not copied from one machine to another. A replacement runner must establish its own identity and obtain permission to resolve the same references. Normal changes are published once and consumed at the next launch or safe restart boundary. No operator should need to distribute revised `.env` files to every enrolled machine.

## Verified capabilities and limits

| Option | Versioned retrieval | Machine access | Operational consequence |
| --- | --- | --- | --- |
| AWS Secrets Manager | `GetSecretValue` accepts `VersionId`; omission of version selectors resolves `AWSCURRENT`. The result identifies the returned version. | IAM authorizes retrieval; a customer-managed KMS key additionally requires decrypt permission. Outside AWS, IAM Roles Anywhere exchanges an X.509 identity for temporary AWS credentials. | Suitable for customers already using AWS. Off-AWS runners still need a trust anchor, role configuration, certificate, and access to the associated private key. [Retrieval API](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html), [Roles Anywhere configuration](https://docs.aws.amazon.com/sdkref/latest/guide/access-rolesanywhere.html) |
| OpenBao KV v2 | A read accepts a numeric `version`; absent a version, it returns the latest. Version retention and destruction can make an old version unavailable. | JWT authentication can validate externally issued identities; AppRole provides machine-oriented roles with token/SecretID TTLs and usage constraints. | Provides a self-hostable alternative. Its operator must configure storage, policies, authentication, backups, and unsealing. [KV API](https://openbao.org/docs/api/secret/kv/kv-v2/), [JWT auth](https://openbao.org/docs/auth/jwt/), [AppRole](https://openbao.org/docs/auth/approle/), [OpenBao source](https://github.com/openbao/openbao), [seal configuration](https://openbao.org/docs/configuration/seal/) |
| Local developer provider — proposed | A local profile revision plus a locally maintained revision identifier; no remote store is implied. | The current OS user or an explicitly configured daemon identity. | Lowest setup burden for one machine. It does not promise automatic cross-machine secret distribution; shared portability requires a reachable provider or a separately designed encrypted distribution facility. |

Additional facts that affect the contract:

- **Launching a process captures its environment.** Node's child-process API accepts an `env` object for the new process. Updating a profile or the parent's environment does not automatically update a child that has already started. “Immutable environment” here means immutable from the orchestrator's perspective for that launch, not that the child cannot change its own variables. AWS documents the same lifecycle limitation for secret injection into ECS containers: rotated values require a fresh task. [Node child processes](https://nodejs.org/api/child_process.html), [ECS secret injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- **Temporary access is different from temporary secret validity.** OpenBao leases dynamic secrets and service tokens, but its key/value backend does not issue secret leases. An expiring token to read a static database password does not itself expire that password at the database. [OpenBao leases](https://openbao.org/docs/concepts/lease/)
- **Automatic credential refresh still needs a root of trust.** The IAM Roles Anywhere helper supports SDK `credential_process` integration and automatically refreshing temporary credentials, while the certificate and private key remain prerequisites. [Roles Anywhere helper](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/credential-helper.html)
- **Self-hosted secret storage requires unlocking.** OpenBao defaults to manual Shamir unsealing. Auto-unseal delegates the root-key operation to another trusted mechanism such as an HSM or cloud KMS; it does not remove the dependency. [OpenBao seal configuration](https://openbao.org/docs/configuration/seal/)

These checks establish provider capabilities, not compatibility with a chosen project dependency set: the repository has no implementation or pinned SDK/runtime versions yet. The OpenBao pages consulted identify themselves as 2.6.x. Exact SDK and platform support must be checked again when implementing an adapter.

## Proposed architecture

The following is a design proposal, not a statement that these facilities already exist.

### Keep references, values, and identities separate

An Environment Profile belongs to an organization and project, has an immutable revision, and describes:

- Ordinary variables and required variable names.
- Logical secret bindings, such as `development.database` and a field selector, without secret values.
- The approved provider connection used to resolve each binding.
- Which operation needs each binding, allowed delivery mode, and the selected freshness/restart policy.

A deployment-specific binding maps `development.database` to an AWS secret ARN, an OpenBao mount/path, or a local source. Sharing a recipe or skill exports its required logical inputs, not the organization's secret paths, credentials, or provider configuration. Ordinary values must be explicitly classified as non-secret before being stored in a shareable manifest.

Illustrative shape only; syntax, names, and API schema remain uncommitted:

```yaml
profile: project-development
revision: 12
variables:
  NODE_ENV: development
bindings:
  DATABASE_URL:
    secret: development.database
    field: url
    delivery: environment
    freshness: resolve-on-attempt-start
```

Proposed ports separate authorization from execution:

- `EnvironmentCatalog` publishes and retrieves profile revisions without exposing values.
- `RunnerIdentity` proves which enrolled machine is making a request and supports revocation.
- `SecretProvider` resolves authorized bindings and reports concrete versions or dynamic-lease metadata.
- `ProcessLauncher` injects only the operation's approved values and owns their cleanup/restart lifecycle.

Provider adapters must report capabilities: exact-version reads, dynamic leases, refresh, revocation, and authorization granularity. Unsupported behavior must produce an explicit result; a provider that cannot pin a version must not quietly substitute the newest value.

### Two authorization layers

The control plane authorizes a particular runner to execute an operation for an organization/project. The secret provider independently authorizes retrieval. An Agents Assemble launch grant does not automatically become an AWS or OpenBao credential.

For AWS, a customer's Roles Anywhere identity can authorize the local daemon to retrieve only that project's development secrets. For OpenBao, use an already trusted workload JWT issuer where available, or enroll an AppRole using narrowly scoped bootstrap credentials. OpenBao supports response wrapping when distributing AppRole SecretIDs. [Roles Anywhere trust model](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/trust-model.html), [OpenBao AppRole delivery](https://openbao.org/docs/auth/approle/)

The proposal is to bind internal launch grants to organization, project, runner, operation attempt, allowed bindings, and expiry. The adapter must state how much of that scope the external provider actually enforces. Fine-grained internal claims alone do not narrow a broad AWS role or OpenBao policy. If the trusted daemon uses broader project credentials, those credentials must remain outside the child process and its accessible filesystem; enforceable process isolation is a prerequisite for treating that separation as a security boundary.

The runner receives only the values needed for the current operation. Do not inherit the daemon's entire `process.env` into a harness or project subprocess: construct an allowlist for ordinary runtime necessities and explicitly selected credentials. Keep Agents Assemble session credentials, Git credentials, harness login state, and application-development secrets separate. Each has a different owner and renewal lifecycle.

### Rotation and replay boundaries

At attempt start, the runner obtains the profile revision, resolves each binding, and records a non-secret resolution receipt before starting work. The receipt contains the profile revision, provider connection identifiers, concrete secret versions where supported, dynamic-lease expiry where applicable, and attempt identity. It contains neither plaintext values nor hashes of secret values.

Routine rotation follows this sequence:

1. An operator or provider rotates a value once in the provider. Changing required names or bindings creates a new Environment Profile revision.
2. New attempts resolve the current authorized versions. Existing attempts keep their launch snapshot until the next defined boundary.
3. A long-running process that requires the update is checkpointed, stopped, and relaunched with a newly resolved environment. A container is recreated when its environment changes.
4. Record the transition as a new attempt/environment receipt. An explicitly supported reload protocol or credential broker may avoid restart for compatible applications; that is an adapter capability to validate later.

When several variables must change together, publish an explicit set of provider versions as a profile revision or store that related bundle as one versioned secret. Reading several independent `latest` references is not a cross-provider atomic snapshot. The profile publication and secret-provider updates cannot be one assumed transaction; publish the profile only after the referenced versions exist and have been validated.

“Resume” does not mean reuse expired credentials. Replaying an old attempt may read its pinned version only if still retained, authorized, and valid at the target service. Otherwise block for environment reconciliation and record the new revision or lease. A dynamic credential is newly issued for a replacement attempt; its old plaintext is never part of the transferable checkpoint.

Configuration change events are useful acceleration, not the only correctness mechanism. The runner should revalidate at launch and reconcile after reconnecting. Duplicate or out-of-order notifications must not regress its chosen revision. Failure to reach a required provider blocks a new launch; silently using an arbitrary stale cached value is not an acceptable default. Poll intervals, bounded cache policies, and emergency-stop behavior remain implementation decisions.

### Revocation has a hard limit

Revoking a runner or provider token prevents future authorized actions according to the relevant enforcement path. It cannot make a process or machine forget a value already received. This is an architectural consequence of delivering plaintext, not a feature any adapter can promise away. Revoking a static-secret read token must be paired with rotating or disabling the credential at its target service when continued use needs to stop; OpenBao's distinction between KV values and leased credentials is relevant here. [OpenBao lease semantics](https://openbao.org/docs/concepts/lease/)

Likewise, deleting a temporary file is cleanup, not a guarantee that no copy remains in memory, logs, child processes, a transcript, or storage. Code with access to a secret can expose it. Avoid placing secrets in planning context, command arguments, durable documents, events, or logs; redact accidental output where possible, without claiming perfect prevention. Environment injection itself makes the value accessible to the application and debugging tools. [ECS environment exposure](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)

## Personal-machine setup and unattended operation

Proposed minimum setup is one enrollment of the daemon, local Git and harness authentication, and one chosen environment-provider login or machine-identity bootstrap. Project cloning, worktree creation, profile fetching, and per-attempt resolution then become automatic.

For a solo developer, support a local provider that reads an explicitly selected file outside the repository or values unlocked from the OS credential store. An ignored `.env` file may be imported deliberately, but must not be uploaded as shared context. Present missing bindings by name and let the developer satisfy them once. This mode can run without AWS or OpenBao, while honestly marking local-only bindings as unavailable on another runner.

A desktop keychain can be locked or require interaction; this must surface as “runner needs unlock,” not an endless retry. Fully unattended startup requires an operator-chosen identity or unlock mechanism available to that daemon after boot, such as workload federation or a machine-managed private key. An encrypted file whose key requires a human passphrase cannot also promise autonomous recovery after reboot. These are proposed product constraints; cross-platform keychain behavior and daemon account access still need a prototype.

Organizations that want seamless migration should configure a shared provider and enroll each machine once. Subsequent value rotations then require no per-machine edits while each machine's identity remains valid. Identity expiry, revoked access, a locked key store, or an unavailable provider can still require intervention. Certificate issuance/renewal and unattended unlock are separate from secret-value rotation and must be documented as such.

## Deferred validation

Before building the environment subsystem, validate exact isolation and launcher behavior for the selected initial harness; the provider's actual scoping and renewal model; multi-secret publication; crash cleanup; private-network reachability; and OS credential-store access under a background daemon. Define how emergency revocation interacts with an offline runner and non-idempotent external effects. Select the initial adapter and bootstrap UX through the existing Wayfinder frontier rather than treating both researched providers as required first-release implementation.
