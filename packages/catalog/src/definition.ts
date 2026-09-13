import { createHash } from "node:crypto";
import { z } from "zod";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonSchema = { [key: string]: Json };
export type Binding =
  | { literal: Json }
  | { ref: { source: string; pointer: string } }
  | { object: Record<string, Binding> }
  | { array: Binding[] };
export type Condition =
  | { eq: [Binding, Binding] }
  | { not: Condition }
  | { all: Condition[] }
  | { any: Condition[] }
  | { exists: { source: string; pointer: string } };
type BaseNode = { id: string; outputSchema?: JsonSchema };
export type Node = BaseNode &
  (
    | { type: "call"; action: string; runtime?: string; with: Binding }
    | { type: "sequence"; children: Node[]; output?: Binding }
    | { type: "choose"; cases: { when: Condition; then: Node }[]; otherwise: Node }
    | { type: "parallel"; join: "all"; maxConcurrency: number; branches: Node[]; output?: Binding }
    | {
        type: "forEach";
        items: Binding;
        key: string;
        maxItems: number;
        maxConcurrency: number;
        body: Node;
        output: Binding;
      }
    | {
        type: "repeat";
        maxIterations: number;
        initial: Binding;
        body: Node;
        until: Condition;
        carry: Binding;
        output: Binding;
      }
    | { type: "end"; result: Binding }
  );
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const pointer = z
  .string()
  .max(2048)
  .refine(
    (value) => value === "" || /^(?:\/(?:[^~]|~[01])*)+$/.test(value),
    "Expected an RFC 6901 pointer",
  );
export const jsonSchema = z.custom<Json>((value) => {
  let count = 0;
  const valid = (item: unknown, depth: number): boolean => {
    if (++count > 100000 || depth > 64) return false;
    if (item === null || typeof item === "boolean" || typeof item === "string") return true;
    if (typeof item === "number") return Number.isFinite(item);
    return (
      typeof item === "object" &&
      (Array.isArray(item) ||
        Object.getPrototypeOf(item) === Object.prototype ||
        Object.getPrototypeOf(item) === null) &&
      Object.values(item).every((child) => valid(child, depth + 1))
    );
  };
  return valid(value, 0);
}, "Expected bounded JSON data");
function safeRecord<T>(
  valueSchema: z.ZodType<T>,
  keySchema: z.ZodType<string> = z.string(),
): z.ZodType<Record<string, T>> {
  return z.custom<Record<string, T>>(
    (value) =>
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([key, item]) => keySchema.safeParse(key).success && valueSchema.safeParse(item).success,
      ),
    "Invalid record member",
  );
}
export const schemaSchema = safeRecord(jsonSchema);
/** OpenAPI-compatible validation that preserves every own JSON key. */
export const preservedJSON = z
  .unknown()
  .refine((value) => jsonSchema.safeParse(value).success, "Expected bounded JSON data");
const referenceSchema = z.strictObject({ source: id, pointer });
export const bindingSchema: z.ZodType<Binding> = z.lazy(() =>
  z.union([
    z.strictObject({ literal: jsonSchema }),
    z.strictObject({ ref: referenceSchema }),
    z.strictObject({ object: safeRecord(bindingSchema) }),
    z.strictObject({ array: z.array(bindingSchema).max(1000) }),
  ]),
);
export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ eq: z.tuple([bindingSchema, bindingSchema]) }),
    z.strictObject({ not: conditionSchema }),
    z.strictObject({ all: z.array(conditionSchema).max(100) }),
    z.strictObject({ any: z.array(conditionSchema).max(100) }),
    z.strictObject({ exists: referenceSchema }),
  ]),
);
const common = { id, outputSchema: schemaSchema.optional() };
export const nodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({
      ...common,
      type: z.literal("call"),
      action: id,
      runtime: id.optional(),
      with: bindingSchema,
    }),
    z.strictObject({
      ...common,
      type: z.literal("sequence"),
      children: z.array(nodeSchema).max(1000),
      output: bindingSchema.optional(),
    }),
    z.strictObject({
      ...common,
      type: z.literal("choose"),
      // biome-ignore lint/suspicious/noThenProperty: The canonical choose-node grammar names its non-callable branch slot then.
      cases: z.array(z.strictObject({ when: conditionSchema, then: nodeSchema })).max(100),
      otherwise: nodeSchema,
    }),
    z.strictObject({
      ...common,
      type: z.literal("parallel"),
      join: z.literal("all"),
      maxConcurrency: z.number().int().min(1).max(100),
      branches: z.array(nodeSchema).min(1).max(100),
      output: bindingSchema.optional(),
    }),
    z.strictObject({
      ...common,
      type: z.literal("forEach"),
      items: bindingSchema,
      key: pointer,
      maxItems: z.number().int().min(1).max(1000),
      maxConcurrency: z.number().int().min(1).max(100),
      body: nodeSchema,
      output: bindingSchema,
    }),
    z.strictObject({
      ...common,
      type: z.literal("repeat"),
      maxIterations: z.number().int().min(1).max(1000),
      initial: bindingSchema,
      body: nodeSchema,
      until: conditionSchema,
      carry: bindingSchema,
      output: bindingSchema,
    }),
    z.strictObject({ ...common, type: z.literal("end"), result: bindingSchema }),
  ]),
);
export const SUPPORTED_RUNNER_CAPABILITIES = [
  "native-account",
  "structured-results",
  "durable-human-requests",
  "checkpoint-recovery",
] as const;
export const runtimeCapabilitySchema = z.enum(SUPPORTED_RUNNER_CAPABILITIES);
export const actionSchema = z.strictObject({
  id: z.string().min(1).max(160),
  version: z.string().min(1).max(80),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(["agent", "human", "integration", "deterministic"]),
  executor: z.enum(["runner", "service"]),
  adapter: z.string().min(1).max(160),
  adapterVersion: z.string().min(1).max(80),
  inputs: schemaSchema,
  outputs: schemaSchema,
  effect: z.enum(["read", "workspace_write", "external_write"]),
  permissions: z.array(z.string().min(1).max(160)).max(100),
  capabilities: z.array(runtimeCapabilitySchema).max(4),
  retry: z.strictObject({
    maxAttempts: z.number().int().min(1).max(10),
    safeErrorClasses: z.array(z.string()).max(20),
    conformance: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  timeoutSeconds: z.number().int().min(1).max(604800),
  cancellation: z.enum(["supported", "reconcile", "unsupported"]),
});
export type ActionDefinition = z.infer<typeof actionSchema>;
export const definitionSchema = z.strictObject({
  formatVersion: z.literal("agents-assemble.playbook/1"),
  package: z.strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9/_-]{0,159}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
  }),
  inputs: schemaSchema,
  outputs: schemaSchema,
  dependencies: z.record(id, actionSchema),
  runtimeSlots: z.record(
    id,
    z.strictObject({
      harness: z.literal("codex"),
      capabilities: z.array(runtimeCapabilitySchema).max(4),
    }),
  ),
  permissions: z.array(z.string().min(1).max(160)).max(100),
  policy: z.strictObject({
    maxInvocations: z.number().int().min(1).max(100000),
    maxConcurrency: z.number().int().min(1).max(100),
    maxExpressionDepth: z.number().int().min(1).max(32),
    maxExpressionNodes: z.number().int().min(1).max(10000),
    referencedSpecChange: z.literal("pause_and_replan"),
  }),
  body: nodeSchema,
  presentation: safeRecord(jsonSchema, z.string().regex(/^[a-z][a-z0-9.-]*:/)).optional(),
});
export type Definition = z.infer<typeof definitionSchema>;
export class DefinitionError extends Error {
  constructor(
    public code: string,
    message: string,
    public path = "",
  ) {
    super(message);
  }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
export function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
const schemaKeywords = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "enum",
  "const",
  "description",
  "title",
  "anyOf",
]);
export function validateSchema(schema: JsonSchema, root = schema, depth = 0): void {
  if (depth > 32) throw new DefinitionError("schema_limit", "Schema nesting exceeds 32");
  for (const key of Object.keys(schema))
    if (!schemaKeywords.has(key))
      throw new DefinitionError(
        "unsupported_schema_keyword",
        `Unsupported JSON Schema keyword: ${key}`,
      );
  if (
    schema.$schema !== undefined &&
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema"
  )
    throw new DefinitionError("unsupported_schema", "Only JSON Schema 2020-12 is supported");
  if (schema.$ref !== undefined) {
    if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/$defs/"))
      throw new DefinitionError(
        "unresolved_schema",
        "Schema references must resolve in pinned local $defs",
      );
    const target = readPointer(root, schema.$ref.slice(1));
    if (!target || typeof target !== "object" || Array.isArray(target))
      throw new DefinitionError("unresolved_schema", "Invalid schema reference");
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (
      !types.length ||
      new Set(types).size !== types.length ||
      types.some(
        (type) =>
          !["null", "boolean", "object", "array", "number", "integer", "string"].includes(
            String(type),
          ),
      )
    )
      throw new DefinitionError("invalid_schema", "Unsupported or duplicate schema type");
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      schema.required.some((key) => typeof key !== "string") ||
      new Set(schema.required).size !== schema.required.length)
  )
    throw new DefinitionError("invalid_schema", "required must be unique property names");
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) ||
      !schema.enum.length ||
      new Set(schema.enum.map(canonical)).size !== schema.enum.length)
  )
    throw new DefinitionError(
      "invalid_schema",
      "enum must be a nonempty array of unique JSON values",
    );
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== "boolean")
    throw new DefinitionError("invalid_schema", "uniqueItems must be a boolean");
  for (const key of ["$id", "description", "title"])
    if (schema[key] !== undefined && typeof schema[key] !== "string")
      throw new DefinitionError("invalid_schema", `${key} must be a string`);
  for (const keyword of ["properties", "$defs"] as const)
    if (schema[keyword] !== undefined) {
      const map = schema[keyword];
      if (!map || typeof map !== "object" || Array.isArray(map))
        throw new DefinitionError("invalid_schema", `${keyword} must be a map`);
      for (const child of Object.values(map))
        validateSchema(schemaSchema.parse(child), root, depth + 1);
    }
  for (const keyword of ["items", "additionalProperties"] as const)
    if (schema[keyword] !== undefined && typeof schema[keyword] !== "boolean")
      validateSchema(schemaSchema.parse(schema[keyword]), root, depth + 1);
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || !schema.anyOf.length)
      throw new DefinitionError("invalid_schema", "anyOf must be a nonempty schema array");
    for (const child of schema.anyOf) validateSchema(schemaSchema.parse(child), root, depth + 1);
  }
  for (const key of ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"])
    if (
      schema[key] !== undefined &&
      (typeof schema[key] !== "number" ||
        !Number.isFinite(schema[key]) ||
        ((key.includes("Items") || key.includes("Length")) &&
          (!Number.isInteger(schema[key]) || (schema[key] as number) < 0)))
    )
      throw new DefinitionError("invalid_schema", `Invalid numeric constraint ${key}`);
  if (schema.pattern !== undefined)
    throw new DefinitionError(
      "unsupported_schema_keyword",
      "pattern is not supported by the bounded schema profile",
    );
}
export function readPointer(value: unknown, path: string): Json {
  if (!pointer.safeParse(path).success)
    throw new DefinitionError("binding_error", "Invalid RFC 6901 pointer", path);
  let current = value;
  for (const token of path === ""
    ? []
    : path
        .slice(1)
        .split("/")
        .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, token) ||
      (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(token))
    )
      throw new DefinitionError("binding_error", `Missing path ${path}`, path);
    current = (current as Record<string, unknown>)[token];
  }
  return jsonSchema.parse(current);
}
export function validateValue(value: unknown, schema: JsonSchema, root = schema, depth = 0): Json {
  if (depth > 64) throw new DefinitionError("binding_error", "Schema evaluation depth exceeded");
  const data = jsonSchema.parse(value);
  const fail = (message: string): never => {
    throw new DefinitionError("binding_error", message);
  };
  if (schema.$ref)
    validateValue(
      data,
      schemaSchema.parse(readPointer(root, String(schema.$ref).slice(1))),
      root,
      depth + 1,
    );
  const type = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
  const types =
    schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (
    types.length &&
    !types.includes(type) &&
    !(type === "number" && Number.isInteger(data) && types.includes("integer"))
  )
    fail(`Expected ${types.join("|")}, received ${type}`);
  if (schema.const !== undefined && canonical(schema.const) !== canonical(data))
    fail("Value differs from const");
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => canonical(item) === canonical(data))
  )
    fail("Value is outside enum");
  if (
    Array.isArray(schema.anyOf) &&
    !schema.anyOf.some((item) => {
      try {
        validateValue(data, schemaSchema.parse(item), root, depth + 1);
        return true;
      } catch {
        return false;
      }
    })
  )
    fail("Value does not match anyOf");
  if (typeof data === "string") {
    const size = [...data].length;
    if (
      (typeof schema.minLength === "number" && size < schema.minLength) ||
      (typeof schema.maxLength === "number" && size > schema.maxLength)
    )
      fail("String length constraint failed");
  }
  if (
    typeof data === "number" &&
    ((typeof schema.minimum === "number" && data < schema.minimum) ||
      (typeof schema.maximum === "number" && data > schema.maximum))
  )
    fail("Number constraint failed");
  if (Array.isArray(data)) {
    if (schema.items === false && data.length) fail("This schema does not allow array items");
    if (
      (typeof schema.minItems === "number" && data.length < schema.minItems) ||
      (typeof schema.maxItems === "number" && data.length > schema.maxItems)
    )
      fail("Array length constraint failed");
    if (schema.uniqueItems === true && new Set(data.map(canonical)).size !== data.length)
      fail("Array items must be unique");
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items))
      for (const item of data) validateValue(item, schema.items, root, depth + 1);
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const properties =
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
        ? schema.properties
        : {};
    for (const key of Array.isArray(schema.required) ? schema.required : [])
      if (!Object.hasOwn(data, String(key))) fail(`Missing required property ${key}`);
    for (const [key, item] of Object.entries(data)) {
      if (Object.hasOwn(properties, key))
        validateValue(item, schemaSchema.parse(properties[key]), root, depth + 1);
      else if (schema.additionalProperties === false) fail(`Unknown property ${key}`);
      else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object" &&
        !Array.isArray(schema.additionalProperties)
      )
        validateValue(item, schema.additionalProperties, root, depth + 1);
    }
  }
  return data;
}
export function evaluateBinding(binding: Binding, scope: Record<string, Json>): Json {
  if ("literal" in binding) return structuredClone(binding.literal);
  if ("ref" in binding) {
    if (!Object.hasOwn(scope, binding.ref.source))
      throw new DefinitionError("binding_error", `Unknown lexical source ${binding.ref.source}`);
    return readPointer(scope[binding.ref.source], binding.ref.pointer);
  }
  if ("array" in binding) return binding.array.map((item) => evaluateBinding(item, scope));
  return Object.fromEntries(
    Object.entries(binding.object).map(([key, item]) => [key, evaluateBinding(item, scope)]),
  );
}
export function evaluateCondition(
  condition: Condition,
  scope: Record<string, Json>,
  budget = { remaining: 10000, depth: 32 },
): boolean {
  if (--budget.remaining < 0 || budget.depth < 1)
    throw new DefinitionError("expression_limit", "Expression budget exhausted");
  const nested = (child: Condition) => {
    budget.depth--;
    try {
      return evaluateCondition(child, scope, budget);
    } finally {
      budget.depth++;
    }
  };
  if ("eq" in condition)
    return (
      canonical(evaluateBinding(condition.eq[0], scope)) ===
      canonical(evaluateBinding(condition.eq[1], scope))
    );
  if ("not" in condition) return !nested(condition.not);
  if ("all" in condition) return condition.all.every(nested);
  if ("any" in condition) return condition.any.some(nested);
  try {
    evaluateBinding({ ref: condition.exists }, scope);
    return true;
  } catch (error) {
    if (error instanceof DefinitionError && error.code === "binding_error") return false;
    throw error;
  }
}
function checkBindings(
  value: Binding | Condition,
  scope: Set<string>,
  depth: number,
  definition: Definition,
  counter: { count: number },
): void {
  if (
    depth > definition.policy.maxExpressionDepth ||
    ++counter.count > definition.policy.maxExpressionNodes
  )
    throw new DefinitionError("expression_limit", "Expression bounds exceeded");
  if ("literal" in value) return;
  const reference = "ref" in value ? value.ref : "exists" in value ? value.exists : undefined;
  if (reference) {
    if (!scope.has(reference.source))
      throw new DefinitionError("lexical_reference", `Source ${reference.source} is not available`);
    return;
  }
  const children =
    "object" in value
      ? Object.values(value.object)
      : "array" in value
        ? value.array
        : "eq" in value
          ? value.eq
          : "not" in value
            ? [value.not]
            : "all" in value
              ? value.all
              : "any" in value
                ? value.any
                : [];
  for (const child of children) checkBindings(child, scope, depth + 1, definition, counter);
}
export function validateDefinition(value: unknown): Definition {
  // Bound raw structure before recursive Zod decoding, including hostile cyclic input.
  let nodes = 0;
  const inspect = (item: unknown, depth: number) => {
    if (++nodes > 100000 || depth > 64)
      throw new DefinitionError("definition_limit", "Definition structural bounds exceeded");
    if (item && typeof item === "object")
      for (const child of Object.values(item)) inspect(child, depth + 1);
  };
  inspect(value, 0);
  const definition = definitionSchema.parse(value);
  validateSchema(definition.inputs);
  validateSchema(definition.outputs);
  for (const action of Object.values(definition.dependencies)) {
    validateSchema(action.inputs);
    validateSchema(action.outputs);
    const { digest: claimed, ...content } = action;
    if (digest(content) !== claimed)
      throw new DefinitionError(
        "dependency_digest",
        `Action ${action.id} digest does not match its complete contract`,
      );
    if (action.adapterVersion !== "1.0.0")
      throw new DefinitionError(
        "unsupported_adapter_version",
        `Action ${action.id} requires unsupported adapter version ${action.adapterVersion}; this release implements 1.0.0`,
      );
    if (
      (action.kind === "deterministic" &&
        (!(action.executor === "runner" ? ["prepare", "check"] : ["echo"]).includes(
          action.adapter,
        ) ||
          (action.executor === "service" && action.effect !== "read"))) ||
      (action.kind === "integration" &&
        ![
          "publishPR",
          "waitMerge",
          "staging",
          "production",
          "verifyHealth",
          "recoverProduction",
        ].includes(action.adapter))
    )
      throw new DefinitionError(
        "unsupported_adapter",
        `Action ${action.id} names unsupported ${action.kind} ${action.executor} adapter ${action.adapter}`,
      );
    if (action.retry.maxAttempts > 1)
      throw new DefinitionError(
        "unsafe_retry",
        "This release has no qualified automatic invocation retry adapter; maxAttempts must be 1. A supplied conformance digest does not grant retry authority.",
      );
    if (action.permissions.some((permission) => !definition.permissions.includes(permission)))
      throw new DefinitionError("permission_gap", "Action permissions exceed declared closure");
    if (
      (action.kind === "agent" && action.executor !== "runner") ||
      (["human", "integration"].includes(action.kind) && action.executor !== "service")
    )
      throw new DefinitionError(
        "executor_mismatch",
        "Agent actions run on runners; human waits and integrations run on the service",
      );
  }
  const counter = { count: 0 };
  const walk = (
    node: Node,
    visible: Set<string>,
    concurrent: boolean,
    ancestors: Set<string>,
  ): number => {
    if (
      visible.has(node.id) ||
      ancestors.has(node.id) ||
      ["input", "item", "carry", "body"].includes(node.id)
    )
      throw new DefinitionError("duplicate_node_id", `Node ${node.id} shadows a visible identity`);
    const scope = new Set(visible);
    const nestedAncestors = new Set([...ancestors, node.id]);
    const check = (binding: Binding | Condition) =>
      checkBindings(binding, scope, 1, definition, counter);
    if (node.outputSchema) validateSchema(node.outputSchema);
    if (node.type === "call") {
      const action = definition.dependencies[node.action];
      if (!action)
        throw new DefinitionError("unresolved_dependency", `Unknown action ${node.action}`);
      if (action.kind === "agent" && !node.runtime)
        throw new DefinitionError("runtime_gap", "Agent action requires runtime slot");
      const runtime = node.runtime ? definition.runtimeSlots[node.runtime] : undefined;
      if (
        node.runtime &&
        (!runtime ||
          action.capabilities.some((capability) => !runtime.capabilities.includes(capability)))
      )
        throw new DefinitionError("runtime_gap", `Missing runtime capability for ${node.runtime}`);
      check(node.with);
      if ("literal" in node.with) validateValue(node.with.literal, action.inputs);
      return action.retry.maxAttempts;
    }
    if (node.type === "end") {
      if (concurrent)
        throw new DefinitionError("concurrent_end", "end cannot abandon concurrent branches");
      check(node.result);
      if ("literal" in node.result) validateValue(node.result.literal, definition.outputs);
      return 0;
    }
    if (node.type === "choose") {
      let work = 0;
      const outputs: string[] = [];
      for (const entry of [
        ...node.cases.map((entry) => ({ node: entry.then, when: entry.when })),
        { node: node.otherwise, when: undefined },
      ]) {
        if (entry.when) check(entry.when);
        work = Math.max(work, walk(entry.node, scope, concurrent, nestedAncestors));
        if (entry.node.type !== "end")
          outputs.push(
            canonical(
              entry.node.outputSchema ??
                (entry.node.type === "call"
                  ? definition.dependencies[entry.node.action].outputs
                  : {}),
            ),
          );
      }
      if (new Set(outputs).size > 1)
        throw new DefinitionError(
          "branch_output_mismatch",
          "Returning branches must declare the same output schema",
        );
      return work;
    }
    if (node.type === "sequence" || node.type === "parallel") {
      const children = node.type === "sequence" ? node.children : node.branches;
      if (node.type === "parallel" && node.maxConcurrency > definition.policy.maxConcurrency)
        throw new DefinitionError("concurrency_limit", "Parallel concurrency exceeds policy");
      const names = new Set<string>();
      let work = 0;
      for (const child of children) {
        if (names.has(child.id)) throw new DefinitionError("duplicate_node_id", child.id);
        names.add(child.id);
        work += walk(child, scope, concurrent || node.type === "parallel", nestedAncestors);
        if (node.type === "sequence") scope.add(child.id);
      }
      for (const name of names) scope.add(name);
      if (node.output) check(node.output);
      return work;
    }
    if (node.type === "forEach") {
      if (
        node.maxConcurrency > definition.policy.maxConcurrency ||
        node.maxConcurrency > node.maxItems
      )
        throw new DefinitionError("concurrency_limit", "Map concurrency exceeds bounds");
      check(node.items);
      scope.add("item");
      const work = walk(node.body, scope, true, nestedAncestors);
      scope.add(node.body.id);
      check(node.output);
      return work * node.maxItems;
    }
    check(node.initial);
    scope.add("carry");
    const work = walk(node.body, scope, concurrent, nestedAncestors);
    scope.add("body");
    check(node.until);
    check(node.carry);
    check(node.output);
    return work * node.maxIterations;
  };
  const work = walk(definition.body, new Set(["input"]), false, new Set());
  if (work > definition.policy.maxInvocations)
    throw new DefinitionError(
      "work_budget",
      `Worst-case invocation count ${work} exceeds ${definition.policy.maxInvocations}`,
    );
  validateTypedBindings(definition);
  return definition;
}
function validateTypedBindings(definition: Definition): void {
  type Scope = Map<string, JsonSchema>;
  const valueShape = (value: Json): JsonSchema => {
    if (value === null) return { type: "null" };
    if (Array.isArray(value))
      return { type: "array", items: value.length ? valueShape(value[0]) : {} };
    if (typeof value === "object")
      return {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, valueShape(child)]),
        ),
        required: Object.keys(value),
        additionalProperties: false,
      };
    return { type: typeof value };
  };
  const pointed = (root: JsonSchema, path: string, allowMissing = false): JsonSchema => {
    let schema = root;
    for (const key of path === ""
      ? []
      : path
          .slice(1)
          .split("/")
          .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
      let hops = 0;
      while (schema.$ref) {
        if (++hops > 32) throw new DefinitionError("schema_limit", "Cyclic schema path");
        schema = schemaSchema.parse(readPointer(root, String(schema.$ref).slice(1)));
      }
      if (schema.type === "array") {
        if (!/^(0|[1-9][0-9]*)$/.test(key))
          throw new DefinitionError("binding_error", "An array pointer must name an index");
        schema =
          schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)
            ? schema.items
            : {};
      } else if (
        schema.properties &&
        typeof schema.properties === "object" &&
        !Array.isArray(schema.properties) &&
        Object.hasOwn(schema.properties, key)
      )
        schema = schemaSchema.parse(schema.properties[key]);
      else if (schema.additionalProperties === false || (schema.type && schema.type !== "object")) {
        if (allowMissing) return {};
        throw new DefinitionError(
          "binding_error",
          `Pointer ${path} does not exist in its declared source schema`,
        );
      } else schema = {};
    }
    return schema;
  };
  const binding = (item: Binding, scope: Scope): JsonSchema => {
    if ("literal" in item) return valueShape(item.literal);
    if ("ref" in item) return pointed(scope.get(item.ref.source) ?? {}, item.ref.pointer);
    if ("array" in item) {
      const items = item.array.map((child) => binding(child, scope));
      return { type: "array", items: items[0] ?? {} };
    }
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(item.object).map(([key, child]) => [key, binding(child, scope)]),
      ),
      required: Object.keys(item.object),
      additionalProperties: false,
    };
  };
  const condition = (item: Condition, scope: Scope): void => {
    if ("eq" in item)
      item.eq.forEach((value) => {
        binding(value, scope);
      });
    else if ("not" in item) condition(item.not, scope);
    else if ("all" in item || "any" in item)
      ("all" in item ? item.all : item.any).forEach((child) => {
        condition(child, scope);
      });
    else pointed(scope.get(item.exists.source) ?? {}, item.exists.pointer, true);
  };
  const compatible = (source: JsonSchema, target: JsonSchema): boolean => {
    if (source.anyOf && Array.isArray(source.anyOf))
      return source.anyOf.every((child) => compatible(schemaSchema.parse(child), target));
    if (target.anyOf && Array.isArray(target.anyOf))
      return target.anyOf.some((child) => compatible(source, schemaSchema.parse(child)));
    const types = (schema: JsonSchema) =>
      schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
    const from = types(source);
    const to = types(target);
    if (
      from.length &&
      to.length &&
      !from.some(
        (type) =>
          to.includes(type) ||
          (type === "integer" && to.includes("number")) ||
          (type === "number" && to.includes("integer")),
      )
    )
      return false;
    const fromProperties =
      source.properties &&
      typeof source.properties === "object" &&
      !Array.isArray(source.properties)
        ? source.properties
        : undefined;
    const toProperties =
      target.properties &&
      typeof target.properties === "object" &&
      !Array.isArray(target.properties)
        ? target.properties
        : undefined;
    if (fromProperties && toProperties) {
      for (const required of Array.isArray(target.required) ? target.required : [])
        if (
          !Object.hasOwn(fromProperties, String(required)) &&
          source.additionalProperties === false
        )
          return false;
      for (const [key, value] of Object.entries(fromProperties))
        if (
          Object.hasOwn(toProperties, key) &&
          !compatible(schemaSchema.parse(value), schemaSchema.parse(toProperties[key]))
        )
          return false;
    }
    return true;
  };
  const visit = (node: Node, inherited: Scope): JsonSchema | null => {
    const scope = new Map(inherited);
    if (node.type === "call") {
      const inferred = binding(node.with, scope);
      if (!compatible(inferred, definition.dependencies[node.action].inputs))
        throw new DefinitionError(
          "binding_error",
          `Call ${node.id} has provably incompatible input bindings`,
        );
      return definition.dependencies[node.action].outputs;
    }
    if (node.type === "end") {
      if (!compatible(binding(node.result, scope), definition.outputs))
        throw new DefinitionError(
          "binding_error",
          "End result is incompatible with the declared run output",
        );
      return null;
    }
    if (node.type === "choose") {
      const branches = node.cases.map((entry) => {
        condition(entry.when, scope);
        return visit(entry.then, scope);
      });
      branches.push(visit(node.otherwise, scope));
      const returning = branches.filter((value): value is JsonSchema => value !== null);
      if (
        returning.length > 1 &&
        returning.some(
          (value) => !compatible(value, returning[0]) || !compatible(returning[0], value),
        )
      )
        throw new DefinitionError(
          "branch_output_mismatch",
          "Returning branches have incompatible inferred output shapes",
        );
      return node.outputSchema ?? returning[0] ?? null;
    }
    if (node.type === "sequence" || node.type === "parallel") {
      const children = node.type === "sequence" ? node.children : node.branches;
      let terminated = false;
      const outputs: Record<string, JsonSchema> = {};
      for (const child of children) {
        const result = visit(child, node.type === "sequence" ? scope : inherited);
        if (result) {
          outputs[child.id] = result;
          scope.set(child.id, result);
        } else if (node.type === "sequence") terminated = true;
      }
      if (terminated) return null;
      return (
        node.outputSchema ??
        (node.output
          ? binding(node.output, scope)
          : node.type === "parallel"
            ? {
                type: "object",
                properties: outputs,
                required: Object.keys(outputs),
                additionalProperties: false,
              }
            : valueShape({}))
      );
    }
    if (node.type === "forEach") {
      const items = binding(node.items, scope);
      if (items.type !== undefined && items.type !== "array")
        throw new DefinitionError("binding_error", "forEach requires an array source");
      scope.set(
        "item",
        items.items && typeof items.items === "object" && !Array.isArray(items.items)
          ? items.items
          : {},
      );
      const result = visit(node.body, scope);
      if (result) scope.set(node.body.id, result);
      return node.outputSchema ?? { type: "array", items: binding(node.output, scope) };
    }
    scope.set("carry", binding(node.initial, scope));
    const result = visit(node.body, scope);
    scope.set("body", result ?? {});
    condition(node.until, scope);
    binding(node.carry, scope);
    return node.outputSchema ?? binding(node.output, scope);
  };
  visit(definition.body, new Map([["input", definition.inputs]]));
}
export function normalizeDefinition(value: unknown): Definition {
  return JSON.parse(canonical(validateDefinition(value))) as Definition;
}
export function toTypeScript(value: unknown): string {
  return `import { definePlaybook } from "@aa/catalog/builder";\n\nexport default definePlaybook(JSON.parse(${JSON.stringify(canonical(normalizeDefinition(value)))}));\n`;
}
