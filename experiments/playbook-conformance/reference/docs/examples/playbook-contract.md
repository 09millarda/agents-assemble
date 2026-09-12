# Illustrative playbook conventions

These examples support [ADR 0002](../architecture/0002-playbook-and-action-contract.md) and decision [#3](https://github.com/09millarda/agents-assemble/issues/3). They are design documents, not executable packages, schema fixtures or proof of harness compatibility. The YAML blocks render a proposed JSON document compactly. Production schemas, exact serialization, resolved digests and concrete runtime profiles are deliberately absent.

## Reading the notation

`$input.name`, `$node.field`, `$item.field` and `$carry.field` abbreviate the explicit `ref` object described by the ADR, with lexical source and JSON Pointer. `$body.field` is available only in a repeat's `until`, `carry` and `output`, after the body has finished and published that field. Literal strings, numbers and booleans abbreviate `literal`; mappings/lists abbreviate `object`/`array`. These abbreviations are editorial notation, not a selected string-interpolation language. A `call` result is bound under the node ID. A composite's `output` exposes only the listed fields to its parent. A `choose` exposes the selected branch's declared output; every returning branch must share its output shape. A terminating branch does not return. Empty sequences are valid identity branches.

All action aliases below denote proposed exact `example/*@0.1.0` action releases. In a real published definition each would require a content digest, pinned input/output schemas, skill/resource closure, semantic adapter contract, timeout/retry policy and permission declaration. The aliases and profiles are illustrative and cannot be resolved from a registry today. Both examples have `formatVersion: agents-assemble.playbook/1` as a proposed grammar identifier, not a published platform version.

## Shared value contracts

| Value | Required information and validation |
| --- | --- |
| `ArtifactRef` | Tenant-scoped artifact ID, immutable revision ID, media type and digest; authorized and retained. Markdown stays in the service. |
| `CheckpointRef` | Verified checkpoint ID binding repository, upstream-reachable commit, artifact revisions and effect receipts under ADR 0001. |
| `ReviewResult` | `accepted: boolean`, reviewed checkpoint, findings artifact; acceptance is for this exact commit and spec. |
| `CheckResult` | `passed: boolean`, checked checkpoint, evidence artifact with commands/results. |
| `ApprovalResult` | `approved: boolean`, request/manifest ID and version, authorized responder and accepted decision receipt. An approved receipt is usable only for the bound operation/revisions/commit. |
| `DeliveryKey` | Service-owned logical change identity with repository/work-item/PR mapping. Stable across linked successor runs; not an arbitrary package-chosen external identifier. |
| `EvidenceList` | Ordered list of immutable findings/check evidence references. Empty is permitted as initial remediation feedback. |

Shapes use JSON Schema 2020-12's `type`, `properties`, `required`, `enum`, local `$ref` and bounded arrays/strings. Nullable optional inputs use an explicit union with `null`. A production schema profile and platform reference validators are still to be written. TypeScript types alone cannot establish artifact ownership, reachability, permission or approval validity.

## Action catalog for these examples

| Alias / kind | Typed input → output | Behavioral contract |
| --- | --- | --- |
| `discover` / agent | brief, checkpoint → findings | Read repository/context and create a service findings artifact. |
| `specify` / agent | brief, findings, optional supplied spec → spec | Draft Markdown or validate/use the exact supplied revision; never overwrite a newer human edit. Missing facts create a durable question before producing a valid spec. |
| `approveSpec` / human | spec → ApprovalResult | Bind implementation scope to that exact spec and definition manifest. Rejection is a typed result. |
| `prepare` / deterministic runner | checkpoint → checkpoint | Verify/reconstruct repository and environment before work; no shared mutable worktree across parallel writers. |
| `implement` / agent | spec, spec approval, checkpoint, feedback → checkpoint | Implement/revise in an isolated worktree; output a verified checkpoint with recorded context. |
| `review` / agent | spec, checkpoint → ReviewResult | Review a read-only snapshot. Output must bind the same checkpoint as checks. |
| `check` / deterministic runner | spec, checkpoint → CheckResult | Run configured checks in a separate workspace at the exact checkpoint; failed checks produce `passed: false`, not an automatic transport retry. |
| `approvePublish` / human | spec, checkpoint, checks, review, delivery key → ApprovalResult | Require successful checks/review on the exact checkpoint, then authorize creating/updating the PR only. |
| `publishPR` / integration | spec, checkpoint, delivery key, approval → PR reference | Reconcile/upsert the delivery's PR using a stable operation ID and business mapping; no merge/deployment authority. |
| `investigate` / agent | report, checkpoint, optional prior findings → findings | Check report sufficiency; durable clarification requests suspend safely without holding a runner lease. |
| `reproduce` / agent | report, findings, checkpoint, previous evidence → result | Return `reproduced: boolean`, reproducible evidence and checkpoint. A claim alone is insufficient; the reproduction contract requires recorded commands/environment/observations. |
| `unreproduced` / human | report, evidence → decision | Typed decision `investigate_again` or `stop`; `evidence` is an ArtifactRef combining the reviewed observations with any additional human evidence, suitable for the next round. No implicit authorization to call a bug reproduced. |

Agent-originated questions create the same durable Human Interaction request/response protocol as a `human` action. An adapter must support suspending/reconstructing the action safely to advertise this capability. The coordinator does not infer typed success, approval or reproduction from terminal prose. Human actions themselves occupy no harness process.

## Common envelope and policy

Both definitions require repository/workspace access, scoped artifact reads/writes and a specific PR create/update operation. A package declares these logical requirements; installation/admission binds them to authorized resources and runner enforcement. Runtime slots `researcher`, `author`, `implementer` and `reviewer` resolve to pinned organization-selected profiles before a run begins. Each declares existing native-account authentication, typed-result delivery, durable-human-request support when needed, and checkpoint recovery. Exact harness/model/effort choices remain configuration, subject to capability validation.

All calls use zero automatic retries unless a pinned adapter explicitly certifies an allowed retry class. Attempt deadlines, human-wait expiry and recovery deadlines must be materialized before publication; these examples omit numeric values because no service levels have been selected. A human deadline expiry suspends/escalates; it never approves. Reproduction and repair use visible bounded domain loops independently of invocation retry policy.

The specification-change policy is `pause_and_replan` under ADR 0002's observation and acknowledgement limits. A successor carries the verified checkpoint, revised spec/report as appropriate, selected prior evidence and inherited delivery mapping as explicit inputs. It begins at entry, revalidates evidence and asks for fresh approvals. It does not duplicate an existing PR merely because it has a new run ID. Selecting a new package/runtime version also requires a new admitted run.

## Additional grammar probe: bounded task fan-out

The two starter journeys below need fixed parallel verification, not agent-generated implementation fan-out. The following fragment makes the `forEach` boundary concrete without silently expanding first-release scope:

```yaml
id: inspectTasks
type: forEach
items: $plan.tasks
key: /id
maxItems: 12
maxConcurrency: 3
body:
  id: inspect
  type: call
  action: inspectTask
  with: {task: $item, checkpoint: $input.checkpoint}
output: {finding: $inspect.finding}
```

`inspectTask` would need its own pinned action contract. Snapshot membership and unique IDs before expansion; reject too many or duplicate IDs before dispatch. Item data cannot replace `action`, increase permissions or mutate the body. `forEach.output` is a per-item projection evaluated against that item body's accepted results. The composite result is the array of these values in snapshot order; each item gets a stable occurrence key. Any failed/unknown item blocks successful completion of the composite. Parallel implementation, if later needed, requires isolated worktrees plus explicit integration/conflict handling.
