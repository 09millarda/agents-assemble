import {
  type Definition,
  evaluateBinding,
  evaluateCondition,
  type Json,
  type Node,
  readPointer,
  validateValue,
} from "@aa/catalog/definition";

export interface Occurrence {
  nodeId: string;
  status: "pending" | "ready" | "running" | "waiting" | "completed" | "failed" | "outcome_unknown";
  input?: Json;
  output?: Json;
  error?: string;
  action?: string;
  runtime?: string;
  choice?: number;
  items?: Json[];
  keys?: string[];
  iteration?: number;
  carries?: Json[];
  invocationId?: string;
  requestId?: string;
  deadline?: string;
}
export interface EngineState {
  status: "running" | "completed" | "failed" | "outcome_unknown";
  nodes: Record<string, Occurrence>;
  ready: string[];
  consumed: number;
  output?: Json;
  error?: string;
}
export const initialState = (): EngineState => ({
  status: "running",
  nodes: {},
  ready: [],
  consumed: 0,
});
interface Returned {
  value: Json;
  ended: boolean;
}
/** Pure interpreter. Call dispatch and every returned state are accepted by Execution in one transaction. */
export function advance(definition: Definition, state: EngineState, input: Json): EngineState {
  if (state.status !== "running") return state;
  const failed = Object.values(state.nodes).find(
    (node) => node.status === "failed" || node.status === "outcome_unknown",
  );
  if (failed) {
    state.status = failed.status === "failed" ? "failed" : "outcome_unknown";
    state.error = failed.error ?? failed.status;
    state.ready = [];
    return state;
  }
  let available =
    definition.policy.maxConcurrency -
    Object.values(state.nodes).filter(
      (node) => ["ready", "running", "waiting"].includes(node.status) && node.action,
    ).length;
  const expression = (
    condition: Parameters<typeof evaluateCondition>[0],
    scope: Record<string, Json>,
  ) =>
    evaluateCondition(condition, scope, {
      remaining: definition.policy.maxExpressionNodes,
      depth: definition.policy.maxExpressionDepth,
    });
  const visit = (node: Node, path: string, scope: Record<string, Json>): Returned | undefined => {
    if (state.status !== "running") return;
    state.nodes[path] ??= { nodeId: node.id, status: "pending" };
    const occurrence = state.nodes[path];
    if (occurrence.status === "completed")
      return { value: occurrence.output ?? null, ended: node.type === "end" };
    if (occurrence.status === "failed" || occurrence.status === "outcome_unknown") {
      state.status = occurrence.status;
      state.error = occurrence.error ?? occurrence.status;
      return;
    }
    const complete = (result: Returned) => {
      if (node.outputSchema) validateValue(result.value, node.outputSchema);
      occurrence.status = "completed";
      occurrence.output = result.value;
      return result;
    };
    if (node.type === "call") {
      if (occurrence.status === "pending" && available > 0) {
        if (state.consumed >= definition.policy.maxInvocations)
          throw new Error("invocation_budget_exhausted");
        const action = definition.dependencies[node.action];
        occurrence.input = validateValue(evaluateBinding(node.with, scope), action.inputs);
        occurrence.status = "ready";
        occurrence.action = node.action;
        if (node.runtime) occurrence.runtime = node.runtime;
        state.ready.push(path);
        state.consumed++;
        available--;
      }
      return;
    }
    if (node.type === "end")
      return complete({
        value: validateValue(evaluateBinding(node.result, scope), definition.outputs),
        ended: true,
      });
    if (node.type === "sequence") {
      const local = { ...scope };
      let last: Json = {};
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i],
          result = visit(child, `${path}/${i}:${child.id}`, local);
        if (!result) return;
        if (result.ended) return complete(result);
        local[child.id] = result.value;
        last = result.value;
      }
      return complete({
        value: node.output ? evaluateBinding(node.output, local) : last,
        ended: false,
      });
    }
    if (node.type === "choose") {
      if (occurrence.choice === undefined) {
        const index = node.cases.findIndex((entry) => expression(entry.when, scope));
        occurrence.choice = index < 0 ? node.cases.length : index;
      }
      const child = node.cases[occurrence.choice]?.then ?? node.otherwise;
      const result = visit(child, `${path}/choice:${occurrence.choice}`, scope);
      return result ? complete(result) : undefined;
    }
    if (node.type === "parallel") {
      const local = { ...scope };
      let active = 0,
        completed = 0;
      for (let i = 0; i < node.branches.length; i++) {
        const child = node.branches[i],
          childPath = `${path}/branch:${i}`;
        if (state.nodes[childPath]?.status !== "completed" && active >= node.maxConcurrency)
          continue;
        const result = visit(child, childPath, { ...scope });
        if (result) {
          if (result.ended) throw new Error("concurrent_end");
          local[child.id] = result.value;
          completed++;
        } else active++;
        if (state.status !== "running") return;
      }
      if (completed === node.branches.length)
        return complete({
          value: node.output
            ? evaluateBinding(node.output, local)
            : Object.fromEntries(node.branches.map((child) => [child.id, local[child.id]])),
          ended: false,
        });
      return;
    }
    if (node.type === "forEach") {
      if (!occurrence.items) {
        const items = evaluateBinding(node.items, scope);
        if (!Array.isArray(items) || items.length > node.maxItems)
          throw new Error("map_membership_limit");
        const keys = items.map((item) => {
          const key = readPointer(item, node.key);
          if (typeof key !== "string" && typeof key !== "number")
            throw new Error("invalid_map_key");
          return `${typeof key}:${key}`;
        });
        if (new Set(keys).size !== keys.length) throw new Error("duplicate_map_key");
        occurrence.items = structuredClone(items);
        occurrence.keys = keys;
      }
      const values: Json[] = [];
      let active = 0;
      for (let i = 0; i < occurrence.items.length; i++) {
        const childPath = `${path}/item:${i}`,
          local = { ...scope, item: occurrence.items[i] };
        if (state.nodes[childPath]?.status !== "completed" && active >= node.maxConcurrency)
          continue;
        const result = visit(node.body, childPath, local);
        if (result) {
          if (result.ended) throw new Error("concurrent_end");
          values.push(evaluateBinding(node.output, { ...local, [node.body.id]: result.value }));
        } else active++;
        if (state.status !== "running") return;
      }
      if (values.length === occurrence.items.length)
        return complete({ value: values, ended: false });
      return;
    }
    occurrence.iteration ??= 0;
    occurrence.carries ??= [evaluateBinding(node.initial, scope)];
    while (occurrence.iteration < node.maxIterations) {
      const local = { ...scope, carry: occurrence.carries[occurrence.iteration] },
        result = visit(node.body, `${path}/iteration:${occurrence.iteration}`, local);
      if (!result) return;
      if (result.ended) return complete(result);
      const after = { ...local, body: result.value };
      if (expression(node.until, after))
        return complete({ value: evaluateBinding(node.output, after), ended: false });
      occurrence.carries.push(evaluateBinding(node.carry, after));
      occurrence.iteration++;
    }
    throw new Error("repeat_bound_exhausted");
  };
  try {
    const result = visit(definition.body, definition.body.id, { input });
    if (result) {
      state.status = "completed";
      state.output = validateValue(result.value, definition.outputs);
    }
  } catch (error) {
    state.status = "failed";
    state.error = error instanceof Error ? error.message : "binding_error";
  }
  if (state.status !== "running") {
    for (const path of state.ready) {
      const node = state.nodes[path];
      if (node.status === "ready" && !node.invocationId) {
        node.status = "pending";
        state.consumed--;
      }
    }
    state.ready = [];
  }
  return state;
}
