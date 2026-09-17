import { afterEach, expect, test } from "bun:test";
import { HttpWorkflowDefinitionAdapter } from "./HttpWorkflowDefinitionAdapter";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
test("workflow list follows opaque pagination cursors", async () => {
  const urls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json(
        urls.length === 1
          ? {
              data: [{ workflowId: "build", name: "Build", activities: [], positions: {} }],
              pagination: { nextCursor: "next/page", limit: 100 },
            }
          : {
              data: [{ workflowId: "ship", name: "Ship", activities: [], positions: {} }],
              pagination: { nextCursor: null, limit: 100 },
            },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const workflows = await new HttpWorkflowDefinitionAdapter("https://factory.example").listWorkflows();
  expect(workflows.map((workflow) => workflow.workflowId)).toEqual(["build", "ship"]);
  expect(urls).toEqual([
    "https://factory.example/v1/workflows?limit=100",
    "https://factory.example/v1/workflows?limit=100&cursor=next%2Fpage",
  ]);
});
test("workflow list serializes name, status, and repeated tag filters", async () => {
  const urls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ data: [], pagination: { nextCursor: null, limit: 100 } });
    },
    { preconnect: originalFetch.preconnect },
  );

  await new HttpWorkflowDefinitionAdapter("https://factory.example").listWorkflows({
    search: "build workflow",
    status: "published",
    tags: ["planning", "delivery"],
  });

  expect(urls).toEqual([
    "https://factory.example/v1/workflows?search=build+workflow&status=published&tag=planning&tag=delivery&limit=100",
  ]);
});
test("workflow edits use explicit update commands and retain complete definitions", async () => {
  const requests: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json(init?.body ? JSON.parse(String(init.body)) : { data: [], pagination: { nextCursor: null } });
    },
    { preconnect: originalFetch.preconnect },
  );
  const adapter = new HttpWorkflowDefinitionAdapter("https://factory.example");
  const definition = { workflowId: "build", name: "Build", description: "", status: "draft" as const, tags: [], activities: [], positions: {} };
  const input = { workflowId: "build", name: "Build", description: "", tags: [], activities: [], positions: {} };
  await adapter.createWorkflow(definition);
  await adapter.updateWorkflow(definition);
  expect(requests).toEqual([
    { url: "https://factory.example/v1/workflows", method: "POST", body: input },
    { url: "https://factory.example/v1/workflows/build/update", method: "POST", body: input },
  ]);
});

test("workflow deletion uses an explicit delete command", async () => {
  const requests: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json({ deleted: true });
    },
    { preconnect: originalFetch.preconnect },
  );

  await new HttpWorkflowDefinitionAdapter("https://factory.example").deleteWorkflow("build");

  expect(requests).toEqual([
    {
      url: "https://factory.example/v1/workflows/build/delete",
      method: "POST",
      body: {},
    },
  ]);
});

test("workflow publication uses explicit lifecycle commands", async () => {
  const requests: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: {} });
      return Response.json({ workflowId: "build" });
    },
    { preconnect: originalFetch.preconnect },
  );

  const adapter = new HttpWorkflowDefinitionAdapter("https://factory.example");
  await adapter.publishWorkflow("build");
  await adapter.unpublishWorkflow("build");

  expect(requests).toEqual([
    { url: "https://factory.example/v1/workflows/build/publish", method: "POST", body: {} },
    { url: "https://factory.example/v1/workflows/build/unpublish", method: "POST", body: {} },
  ]);
});
