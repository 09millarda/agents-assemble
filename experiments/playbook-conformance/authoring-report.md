# Disposable authoring conformance evidence for decision #6

Result: the two actual starter definitions and the additional fan-out fragment survive the supported JSON document operations. The independently composed local TypeScript feature definition emits an equivalent normalized document. This is evidence for retaining the declarative grammar and shared document boundary; it is not a production editor, SDK, schema standard or adapter certification.

## Files and provenance

- `fixtures.json`: actual YAML blocks extracted with PyYAML 6.0.3 from `docs/examples/new-feature.playbook.md`, `bug-fix.playbook.md` and `playbook-contract.md`. Node IDs, array order and all source control flow are retained. Editorial `$source.field` notation becomes `{ref:{source,pointer}}`; scalars, mappings and arrays become `literal`, `object` and `array` bindings. The fragment is placed after a mock `planTasks` action so its original `$plan.tasks` source has a real lexical binding. Only this harness wrapper is additional control flow.
- The illustrative input/output type names become explicit mock schemas. Actions have exact `example/*@0.1.0` identities, SHA-256 content pins, input/output schemas, executor/adapter identities, capability declarations and concrete timeout/attempt policies. The mock `discover` action declares `maxAttempts: 2` and `retryableErrors: ["mock_read_transport"]`; `implement` declares `maxAttempts: 2` and `retryableErrors: ["mock_verified_reconstruction"]`. All other mock actions retain one attempt and no retry class. These two mock capabilities exercise bounded safe retry and verified workspace reconstruction; they are not real adapter certifications. Runtime slots and numerical expression/work/deadline defaults are materialized. These numerical values and mock versions are experiment choices, not selected service levels or a public release.
- `authoring.js`: a dependency-free browser single script and Node-loadable module exposing `globalThis.Authoring`. Its data is the same fixture catalog. APIs include `normalize`, `validate`, `validateValue(value, schema)`, `evaluateBinding`, `evaluateCondition`, `editDocument`, `canonical` and `testAuthoring`.
- `builder.ts`: independently constructs the complete feature journey from local helper functions for calls, sequences, approval branches, repeat, parallel verification and terminal outcomes. It imports the primitive schema/action catalog, but never clones the parsed feature fixture to construct its body or envelope. `node builder.ts --emit` emits the resulting canonical JSON document.

## Executed results

Executed using Node v24.21.0 on 2026-09-12:

- **25/25 authoring scenarios passed.** Three definition normalization/import/export roundtrips; bounded editor edit/undo; preservation of raw rejected input; rejection of executable callbacks; named rejection of unknown behavioral fields, unsupported schema keyword, external schema reference, malformed schema type, unsupported capability, missing native-account capability, malformed pointer, concurrent/late sibling reference, node ID shadowing, incompatible choice output field types, unknown format and pin drift; preservation of namespaced nonsemantic metadata; runtime boundary type rejection; missing runtime reference as `binding_error`; JSON equality, short-circuiting, local pinned schema references and RFC 6901 escapes.
- **Independent full-feature TypeScript builder equivalence passed.** Its emitted text was parsed back into JSON, normalized and compared against the independently YAML-derived fixture. Editing `delivery.maxIterations` from 3 to 2 and back to 3 preserved the complete normalized document, including every ID, ordered array, dependency pin and policy field.
- As an integration cross-check after runtime schema enforcement was added, **24/24 runtime scenarios passed**. A separate audit validated **300 action input/output values** present in their final logged states against the pinned schemas, with **zero errors**. These counts describe the runtime snapshot available when this report was written; the runtime agent owns its scenarios and final runtime evidence.

Reproduce authoring checks:

```sh
node -e "require('./authoring.js'); const r=Authoring.testAuthoring(); console.log(JSON.stringify(r,null,2)); if(r.some(x=>!x.passed))process.exitCode=1"
node builder.ts
node builder.ts --emit
```

## What the roundtrip establishes

It establishes normalized JSON semantic equivalence for the two full source definitions and one fragment wrapper, and independent helper-based TypeScript construction for the complete feature definition. The structured edit operates directly on the document and validates the whole result. It has no field-specific intermediate model that can silently discard an unsupported behavioral field. Normalization materializes defaults and sorts object keys, while preserving array order; unsupported input remains untouched for raw export. No executable callback crosses the document boundary.

The supported schema subset is explicit: `type`, `properties`, `required`, `additionalProperties` (boolean), `items`, array/string bounds, numeric bounds, `enum`, `$defs` and pinned local `$ref`. Unsupported keywords and external references fail visibly. Lexical validation prevents concurrent sibling reads, forward reads and visible ID shadowing. Choice validation compares recursively inferred result shapes. Actual values are checked at runtime boundaries; this does not attempt arbitrary schema-to-schema subtyping.

## Limits and follow-on requirements

- The editor operation is a lossless structured document mutation, not proof of a complete graphical canvas or usability. It targets unique node IDs; when identical IDs are legal in distinct lexical scopes, it rejects ambiguous edits and would need structural path selection. The parent experiment supplies the interactive browser view separately.
- Only the feature journey has an independent TypeScript reconstruction. Bug/fan-out equivalence covers JSON import/edit/export, not separate TypeScript helper generation for every supported document. Node stripped TypeScript annotations; no `tsc` typecheck or static type-safety claim was made.
- These are selected examples and rejection probes, not an exhaustive grammar proof. There is no schema-to-schema theorem, complete JSON Schema implementation, recursive schema support, schema migration, byte/signature standard, registry transport or production package verification. Exact fixture pins resolve a local trusted mock catalog.
- Artifact/checkpoint schemas establish shape only. They cannot establish tenant ownership, authorization, retention or Git reachability. Approval `manifest` is explicitly a typed opaque object in the mock schema; the runtime separately enforces equality against its frozen gate manifest. Real manifest schemas and request/receipt contracts remain to be pinned.
- Capability tests validate declarations against the supplied mock capability set. They do not establish native login, harness resume, context limits, permission enforcement or cost controls for an installed runner.
- The normalizer is deliberately restricted to plain finite JSON data, and metadata uses a namespaced nonsemantic container. Extending the grammar/schema subset or allowing new metadata semantics requires explicit versioned support in every editor and executor.
