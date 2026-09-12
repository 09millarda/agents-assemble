# Portable playbook authoring contract

Date: 2026-09-12. Research supporting [decision #3](https://github.com/09millarda/agents-assemble/issues/3). These are recommendations, not accepted decisions. Scope: definition grammar, schemas, expression boundaries, versioning, and UI/TypeScript authoring. Execution frameworks and persistence implementation are outside this note. Local requirements come from [CONTEXT.md](../../CONTEXT.md) and the [product charter](../product-charter.md).

## Recommendation

Use one canonical JSON data model, with an explicit contract version, for import/export, API storage, visual editing, and locally emitted TypeScript definitions. Publish immutable, self-contained dependency bundles. Start with a small structured control grammar and a data-only expression tree that the UI can edit completely. Treat schema validation, definition semantics, and execution authorization as separate checks.

## Verified findings

| Source fact | Implication for this decision |
| --- | --- |
| JSON Schema 2020-12 separates a schema's dialect (`$schema`) from its resource identity (`$id`), permits bundled resources, and treats JSON objects as unordered. [Core §§4.2.1, 8.1.1, 8.2.1, 9.3.1](https://json-schema.org/draft/2020-12/json-schema-core) | Specify playbook contract version separately from embedded input/output schema dialect and definition release. Do not infer execution order from object property order. |
| Unknown JSON Schema keywords are normally annotations; required vocabularies can require refusal when unsupported. [Core §§4.3.1, 8.1.2](https://json-schema.org/draft/2020-12/json-schema-core#section-8.1.2) | A schema's syntactic acceptance does not prove the runtime understands its constraints. Validate the supported schema profile explicitly. |
| `format` assertion is optional under the default dialect; `default` appears among metadata annotations. [Validation §§7.2, 9.2](https://json-schema.org/draft/2020-12/json-schema-validation) | Do not rely on an arbitrary validator to enforce timestamps/URIs or populate missing inputs. Specify semantic checks and normalization separately. |
| Serverless Workflow v1.0.0 defines sequential `Do`, concurrent `Fork`, collection `For`, and conditional `Switch`. Its fork explicitly distinguishes competing branches from a join and describes output order. It also requires broader task types, including script/shell execution. [Versioned DSL reference](https://github.com/serverlessworkflow/specification/blob/v1.0.0/dsl-reference.md#task) | These are useful grammar precedents. Adopting a similarly shaped subset does not establish Serverless Workflow conformance or select its execution model. |
| TypeScript removes type annotations when producing JavaScript. [TypeScript handbook: erased types](https://www.typescriptlang.org/docs/handbook/2/basic-types.html#erased-types) | A TypeScript authoring API cannot replace runtime validation of imported definitions, bound inputs, or returned outputs. |
| CEL expressions have a parse/check/evaluate lifecycle; the embedding service supplies the environment. CEL's language requires extension functions to have no observable side effects. [CEL overview](https://cel.dev/overview/cel-overview), [language definition: functions](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#functions) | CEL is a plausible later expression language, but selecting it also requires environment/version rules and an implementation-conformance check. |
| SemVer forbids modifying a released version and depends on an explicitly defined public API. [SemVer 2.0.0 §§1, 3](https://semver.org/spec/v2.0.0.html) | Version labels express compatibility intent; exact dependency snapshots still need immutable identities and integrity checks. |

## Proposed minimal grammar

Use stable node IDs and a tagged union. Keep human-facing stages as metadata, with no scheduling effects. The following are design recommendations, not names required by an external standard.

| Node | Recommended contract |
| --- | --- |
| `invoke` | Reference one immutable action version; bind typed inputs; expose typed outputs. Agent, human, integration, and deterministic actions share the envelope but declare different configuration and requirements. |
| `sequence` | An ordered array of child nodes. Each child can reference completed predecessors in its lexical scope. |
| `condition` | A Boolean predicate and explicit `then`/`else` children. Declare one output schema and branch-specific output bindings. Missing data is not implicitly `false` or `null`. |
| `parallel` | A fixed array of branches with explicit concurrency limit and `join: all` initially. Outputs are keyed by stable branch ID. Branches have isolated inputs and no shared mutable result object. Failure/cancellation behavior must be normative in the execution contract. |
| `repeat` | Explicit typed initial state, body, next-state binding, exit predicate, positive maximum iteration count, and an exhaustion outcome. Choose one documented evaluation order; recommend body → state update → exit test. Iteration identity differs from an action retry. |

Reject arbitrary jumps, recursive playbook invocation, dynamic node creation, and unbounded loops in this initial contract. Static nesting plus explicit data flow makes the next executable work and UI structure inspectable. A finite iteration count does not guarantee short completion: action deadlines, human waits, run budgets, and failure handling still need their own policies.

## Inputs, outputs, and capabilities

Recommended initial schema profile: JSON primitives, homogeneous arrays, objects with explicit required fields, string enums, numeric/string/collection bounds, local bundled `$ref`, and disjoint tagged unions. Make absent and nullable distinct. Use explicit object closure for the definition envelope; reserve a named metadata/extension container for information that has no execution effect. The 2020-12 `unevaluatedProperties` keyword can close composed object schemas, but its evaluation rules are more involved than flat `additionalProperties`. [Core §11.3](https://json-schema.org/draft/2020-12/json-schema-core#section-11.3)

Keep the initial profile narrow enough to render forms and generate useful TypeScript types. Reject unsupported validation keywords visibly instead of retaining them as inert safety constraints. Bundle schema resources and resolve them from the bundle; runtime validation must not fetch arbitrary remote URLs. Cap nesting, document sizes, and validation work.

At publication, validate node IDs, dependency existence, lexical references, branch output shapes, bounds, and supported schema features. Check binding compatibility conservatively within the supported profile. At invocation and result acceptance, validate actual values again. Unknown compatibility should produce a useful diagnostic or require an explicit adapter action; do not equate two arbitrary JSON Schemas by superficial shape.

An action should declare required versioned capabilities, effect/permission requirements, and referenced runtime-profile/skill versions. A runtime profile should retain exact requested harness/model/effort settings. Requirements describe eligibility; they do not grant organization permissions or prove a runner currently possesses a capability. Unsupported requirements should block execution visibly. Allow new capabilities through the declared extension mechanism and publish conformance examples for their meaning.

## Expressions and round trips

Recommend a small tagged expression AST for v1: literals; typed references; object/array construction; `eq`, `ne`, ordered comparisons for matching scalar types; `exists`; and Boolean `all`, `any`, `not`. Restrict predicates to Boolean results, define strict equality without coercion, and make missing-reference/type errors explicit. Reference fields can use JSON Pointer inside an explicitly identified input/output scope; JSON Pointer defines location syntax and escaping, not execution scope or missing-value policy. [RFC 6901 §§3–4, 7](https://www.rfc-editor.org/rfc/rfc6901.html)

Do not interpret ordinary strings as executable expressions. Do not expose ambient time, random values, environment variables, network access, or secret values to this evaluator. If time is needed, make it an explicit persisted input. Any future CEL alternative needs a language/environment identifier, allowlisted pure functions, input/output limits, cost limits, numeric semantics, and a verified TypeScript-host implementation. Non-Turing completeness alone does not establish an operational resource budget. [CEL design](https://cel.dev/), [language definition](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md)

The authoring contract should guarantee `normalize(export(import(definition))) == normalize(definition)` for every supported definition, including IDs, expressions, metadata, and dependency references. TypeScript builders should emit this data locally. The service should accept the emitted data rather than executing uploaded TypeScript. UI export can generate equivalent TypeScript builder code; preserving original comments, helper functions, and formatting is a separate source-editing feature and should not be promised implicitly.

For a newer unsupported contract, permit read-only viewing/export or reject editing clearly. Preserve opaque non-executable metadata, but never save an executable document after silently discarding unknown semantics. Do not claim editable round trips for arbitrary CEL source merely because the UI can display a text box.

## Publication and version pinning

Distinguish four identities: authoring contract version; definition identity/release; embedded schema dialect; and resolved dependency identity. Recommend publication resolves all action, child-playbook, skill, schema, and runtime-profile references to exact immutable versions and records content digests in a lock manifest. Store that closure with the run; never consult mutable `latest` aliases during resume. Export must include enough content for an independent installation to validate and import without the public registry.

Define the digest encoding and normalization algorithm before implementing integrity checks. RFC 8785 is an available JSON canonicalization scheme, but its number representation assumes IEEE 754 doubles and forbids duplicate object keys; larger exact numbers need an agreed string representation. [RFC 8785 §3.1](https://www.rfc-editor.org/rfc/rfc8785.html#section-3.1) This is a trade-off to settle, not a hashing-library selection.

Keep old published definitions readable with their original interpreter semantics. A contract migration should produce a new draft/version and an explicit semantic diff. Changes to prompts, skills, runtime settings, capabilities, expressions, or defaults create new published content even when field shapes remain compatible.

## Validation evidence still required

Before accepting implementation-ready interfaces, validate representative feature and bug-fix definitions through JSON → UI model → JSON and JSON → generated TypeScript → JSON; exercise a revision-bound human gate, a failed parallel branch, a missing condition input, repeat exhaustion, and an unsupported capability. Include an exported dependency bundle imported with registry access disabled. These are proposed contract acceptance cases; this research note has not run them or selected a runtime library.
