import { expect, test } from "vitest";
import { type Definition, digest } from "../../catalog/src/definition.ts";
import { advance, initialState } from "./interpreter.ts";

const action = {
  id: "echo",
  version: "1.0.0",
  kind: "deterministic" as const,
  executor: "service" as const,
  adapter: "echo",
  adapterVersion: "1.0.0",
  inputs: {},
  outputs: {},
  effect: "read" as const,
  permissions: [],
  capabilities: [],
  retry: { maxAttempts: 1, safeErrorClasses: [] },
  timeoutSeconds: 60,
  cancellation: "supported" as const,
};
const definition = (body: Definition["body"]): Definition => ({
  formatVersion: "agents-assemble.playbook/1",
  package: { id: "test", version: "1.0.0" },
  inputs: {},
  outputs: {},
  dependencies: { echo: { ...action, digest: digest(action) } },
  runtimeSlots: {},
  permissions: [],
  policy: {
    maxInvocations: 10,
    maxConcurrency: 2,
    maxExpressionDepth: 32,
    maxExpressionNodes: 100,
    referencedSpecChange: "pause_and_replan",
  },
  body,
});
test("sequences retain accepted outputs and expose one stable call occurrence", () => {
  const spec = definition({
    type: "sequence",
    id: "root",
    children: [
      { type: "call", id: "first", action: "echo", with: { literal: { x: 1 } } },
      { type: "end", id: "done", result: { ref: { source: "first", pointer: "" } } },
    ],
  });
  const state = initialState();
  advance(spec, state, {});
  expect(state.ready).toHaveLength(1);
  const path = state.ready[0];
  state.nodes[path].status = "completed";
  state.nodes[path].output = { accepted: true };
  state.ready = [];
  advance(spec, state, {});
  expect(state.status).toBe("completed");
  expect(state.output).toEqual({ accepted: true });
  expect(state.consumed).toBe(1);
});
test("bounded fan-out captures unique keys and never succeeds over unknown outcomes", () => {
  const spec = definition({
    type: "forEach",
    id: "map",
    maxItems: 3,
    maxConcurrency: 2,
    key: "/id",
    items: { ref: { source: "input", pointer: "" } },
    body: {
      type: "call",
      id: "echoItem",
      action: "echo",
      with: { ref: { source: "item", pointer: "" } },
    },
    output: { ref: { source: "echoItem", pointer: "" } },
  });
  const state = initialState();
  advance(spec, state, [{ id: "a" }, { id: "b" }, { id: "c" }]);
  expect(state.ready).toHaveLength(2);
  state.nodes[state.ready[0]].status = "outcome_unknown";
  advance(spec, state, [{ id: "changed" }]);
  expect(state.status).toBe("outcome_unknown");
  expect(state.consumed).toBe(2);
});
test("duplicate map keys reject before dispatch", () => {
  const spec = definition({
    type: "forEach",
    id: "map",
    maxItems: 3,
    maxConcurrency: 2,
    key: "/id",
    items: { literal: [{ id: "x" }, { id: "x" }] },
    body: { type: "call", id: "work", action: "echo", with: { literal: null } },
    output: { literal: null },
  });
  const state = initialState();
  advance(spec, state, {});
  expect(state.status).toBe("failed");
  expect(state.ready).toEqual([]);
});

test("a failed parallel sibling prevents any new dispatch even when visited last", () => {
  const spec = definition({
    type: "parallel",
    id: "root",
    join: "all",
    maxConcurrency: 2,
    branches: [
      { type: "call", id: "first", action: "echo", with: { literal: null } },
      { type: "call", id: "last", action: "echo", with: { literal: null } },
    ],
  });
  const state = initialState();
  state.nodes["root/branch:1"] = {
    nodeId: "last",
    action: "echo",
    status: "failed",
    error: "definitive failure",
    invocationId: "accepted",
  };
  state.consumed = 1;
  advance(spec, state, {});
  expect(state.status).toBe("failed");
  expect(state.ready).toEqual([]);
  expect(state.consumed).toBe(1);
  expect(state.nodes["root/branch:0"]).toBeUndefined();
});
