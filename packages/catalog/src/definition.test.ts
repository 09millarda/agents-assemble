import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  type Definition,
  digest,
  evaluateBinding,
  evaluateCondition,
  type Node,
  normalizeDefinition,
  toTypeScript,
  validateDefinition,
  validateSchema,
  validateValue,
} from "./definition.ts";

const empty = { type: "object", additionalProperties: false };
export function fixture(body: Node = { id: "entry", type: "sequence", children: [] }): Definition {
  const action = {
    id: "test/check",
    version: "1.0.0",
    kind: "deterministic" as const,
    executor: "service" as const,
    adapter: "echo",
    adapterVersion: "1.0.0",
    inputs: empty,
    outputs: empty,
    effect: "read" as const,
    permissions: [],
    capabilities: [],
    retry: { maxAttempts: 1, safeErrorClasses: [] },
    timeoutSeconds: 10,
    cancellation: "supported" as const,
  };
  return {
    formatVersion: "agents-assemble.playbook/1",
    package: { id: "test/test", version: "1.0.0" },
    inputs: empty,
    outputs: empty,
    dependencies: { check: { ...action, digest: digest(action) } },
    runtimeSlots: {},
    permissions: [],
    policy: {
      maxInvocations: 100,
      maxConcurrency: 4,
      maxExpressionDepth: 32,
      maxExpressionNodes: 1000,
      referencedSpecChange: "pause_and_replan",
    },
    body,
  };
}
const call = (id: string): Node => ({ id, type: "call", action: "check", with: { literal: {} } });
describe("public canonical definition contract", () => {
  it("executes generated TypeScript without interpreting reserved JSON keys as JavaScript prototype syntax", async () => {
    const source = fixture({
      id: "finish",
      type: "end",
      result: { literal: JSON.parse('{"__proto__":{"retained":true},"text":"Unicode ☃"}') },
    });
    source.outputs = {};
    const directory = await mkdtemp(join(process.cwd(), ".generated-playbook-"));
    try {
      const path = join(directory, "playbook.ts");
      await writeFile(path, toTypeScript(source));
      const result = await promisify(execFile)(process.execPath, [
        "--import=tsx",
        "--input-type=module",
        "-e",
        "const module = await import(process.argv[1]); process.stdout.write(JSON.stringify(module.default));",
        pathToFileURL(path).href,
      ]);
      expect(JSON.parse(result.stdout)).toEqual(source);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("round trips without losing policy, presentation or lexical IDs", () => {
    const source = fixture({
      id: "entry",
      type: "sequence",
      children: [call("one"), call("two")],
      output: { object: { value: { ref: { source: "one", pointer: "" } } } },
    });
    source.presentation = { "editor:data": JSON.parse('{"__proto__":{"x":1}}') };
    expect(normalizeDefinition(JSON.parse(JSON.stringify(source)))).toEqual(source);
    expect(toTypeScript(source)).toContain("__proto__");
  });
  it("rejects hidden behavior, unresolved dependency and tampered pinned action", () => {
    expect(() => validateDefinition({ ...fixture(), script: "execute()" })).toThrow();
    expect(() => validateDefinition(fixture({ ...call("x"), action: "missing" } as Node))).toThrow(
      /Unknown action/,
    );
    const value = fixture();
    value.dependencies.check.timeoutSeconds++;
    expect(() => validateDefinition(value)).toThrow(/digest/);
  });
  it("rejects self-claimed automatic retry conformance before publication", () => {
    const source = fixture();
    const { digest: _prior, ...action } = source.dependencies.check;
    action.retry = {
      maxAttempts: 2,
      safeErrorClasses: ["claimed_safe"],
      conformance: "a".repeat(64),
    };
    source.dependencies.check = { ...action, digest: digest(action) };
    expect(() => validateDefinition(source)).toThrow(
      /no qualified automatic invocation retry adapter/,
    );
  });
  it.each([
    { adapterVersion: "2.0.0" },
    { adapter: "check" },
    { effect: "workspace_write" as const },
    { executor: "runner" as const, adapter: "unknown" },
    { kind: "integration" as const, adapter: "unknown" },
    { kind: "integration" as const, executor: "runner" as const, adapter: "publishPR" },
  ])("rejects unavailable adapter semantics even with a matching content digest: %j", (change) => {
    const source = fixture();
    const { digest: _prior, ...prior } = source.dependencies.check;
    const action = { ...prior, ...change };
    source.dependencies.check = { ...action, digest: digest(action) };
    expect(() => validateDefinition(source)).toThrow(/unsupported|integrations run on the service/);
  });
  it("rejects out-of-scope references, visible shadowing and concurrent sibling reads", () => {
    expect(() =>
      validateDefinition(
        fixture({ id: "entry", type: "sequence", children: [call("same"), call("same")] }),
      ),
    ).toThrow(/shadows|same/);
    expect(() =>
      validateDefinition(
        fixture({
          id: "entry",
          type: "parallel",
          join: "all",
          maxConcurrency: 2,
          branches: [
            call("first"),
            {
              id: "second",
              type: "call",
              action: "check",
              with: { ref: { source: "first", pointer: "" } },
            },
          ],
        }),
      ),
    ).toThrow(/not available/);
  });
  it("enforces total nested work and concurrent end rules", () => {
    const node: Node = {
      id: "loop",
      type: "repeat",
      maxIterations: 101,
      initial: { literal: {} },
      body: call("action"),
      until: { eq: [{ literal: true }, { literal: true }] },
      carry: { literal: {} },
      output: { literal: {} },
    };
    expect(() => validateDefinition(fixture(node))).toThrow(/invocation count/);
    expect(() =>
      validateDefinition(
        fixture({
          id: "parallel",
          type: "parallel",
          join: "all",
          maxConcurrency: 1,
          branches: [{ id: "exit", type: "end", result: { literal: {} } }],
        }),
      ),
    ).toThrow(/abandon/);
  });
  it("supports every node in a bounded non-executing authoring roundtrip", () => {
    const root: Node = {
      id: "entry",
      type: "sequence",
      children: [
        {
          id: "choice",
          type: "choose",
          cases: [
            {
              when: { not: { exists: { source: "input", pointer: "/missing" } } },
              // biome-ignore lint/suspicious/noThenProperty: The canonical choose-node grammar names its non-callable branch slot then.
              then: call("chosen"),
            },
          ],
          otherwise: call("fallback"),
        },
        {
          id: "map",
          type: "forEach",
          items: { literal: [{ id: "one" }] },
          key: "/id",
          maxItems: 2,
          maxConcurrency: 1,
          body: call("itemCall"),
          output: { ref: { source: "itemCall", pointer: "" } },
        },
        {
          id: "repetition",
          type: "repeat",
          maxIterations: 2,
          initial: { literal: {} },
          body: call("repeatCall"),
          until: { any: [{ eq: [{ literal: 1 }, { literal: 1 }] }] },
          carry: { ref: { source: "body", pointer: "" } },
          output: { ref: { source: "body", pointer: "" } },
        },
        {
          id: "parallel",
          type: "parallel",
          join: "all",
          maxConcurrency: 1,
          branches: [call("branch")],
        },
        { id: "finished", type: "end", result: { literal: {} } },
      ],
    };
    expect(normalizeDefinition(fixture(root))).toEqual(fixture(root));
  });
});
describe("bounded boundary evaluation", () => {
  it("distinguishes missing, null, false and zero and handles RFC 6901", () => {
    const scope = { input: { "a/b": { "~": false }, n: null, z: 0 } };
    expect(evaluateBinding({ ref: { source: "input", pointer: "/a~1b/~0" } }, scope)).toBe(false);
    expect(evaluateCondition({ exists: { source: "input", pointer: "/n" } }, scope)).toBe(true);
    expect(evaluateCondition({ exists: { source: "input", pointer: "/missing" } }, scope)).toBe(
      false,
    );
    expect(() => evaluateBinding({ ref: { source: "input", pointer: "/missing" } }, scope)).toThrow(
      /Missing/,
    );
    expect(evaluateCondition({ eq: [{ literal: "0" }, { literal: 0 }] }, scope)).toBe(false);
  });
  it("short circuits conditions and enforces boundary schemas", () => {
    expect(
      evaluateCondition(
        {
          all: [
            { eq: [{ literal: 1 }, { literal: 2 }] },
            { eq: [{ ref: { source: "unknown", pointer: "" } }, { literal: true }] },
          ],
        },
        {},
      ),
    ).toBe(false);
    expect(() => validateSchema({ $ref: "https://attacker.invalid/schema" })).toThrow();
    expect(() => validateSchema({ unevaluatedProperties: false })).toThrow();
    expect(() => validateSchema({ enum: "ignored-behavior" })).toThrow();
    expect(() => validateSchema({ uniqueItems: "true" })).toThrow();
    expect(() => validateValue(["disallowed"], { type: "array", items: false })).toThrow(
      /does not allow/,
    );
    expect(() =>
      validateValue(
        { value: "1" },
        {
          type: "object",
          properties: { value: { type: "integer" } },
          required: ["value"],
          additionalProperties: false,
        },
      ),
    ).toThrow(/Expected/);
    expect(() => validateValue(["x", "x"], { type: "array", uniqueItems: true })).toThrow(/unique/);
  });
});
it("rejects provably missing typed paths and incompatible action inputs before publication", () => {
  const missing = fixture({
    id: "use",
    type: "call",
    action: "check",
    with: { ref: { source: "input", pointer: "/missing" } },
  });
  expect(() => validateDefinition(missing)).toThrow(/path|pointer|missing/i);
  const mismatch = fixture({
    id: "use",
    type: "call",
    action: "check",
    with: { literal: "not an object" },
  });
  expect(() => validateDefinition(mismatch)).toThrow(/incompatible|Expected|type/i);
});
