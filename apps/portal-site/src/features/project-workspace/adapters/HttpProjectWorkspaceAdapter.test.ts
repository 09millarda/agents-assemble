import { afterEach, expect, test } from "bun:test";
import { HttpProjectWorkspaceAdapter } from "./HttpProjectWorkspaceAdapter";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
test("project enablement and setup settings use workflow commands", async () => {
  const seen: { url: string; body: unknown }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({
        projectId: "project-1",
        enabledWorkflowIds: ["build"],
        setupCommand: "pnpm install",
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const workspace = new HttpProjectWorkspaceAdapter("https://factory.example");
  await workspace.setEnabledWorkflowIds("project-1", ["build"]);
  await workspace.setSettings("project-1", { setupCommand: "pnpm install" });
  expect(seen).toEqual([
    {
      url: "https://factory.example/v1/projects/project-1/enabled-workflows",
      body: { workflowIds: ["build"] },
    },
    {
      url: "https://factory.example/v1/projects/project-1/settings",
      body: { setupCommand: "pnpm install" },
    },
  ]);
});

test("project name updates use the project name command", async () => {
  const seen: { url: string; body: unknown }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({
        projectId: "project-1",
        name: "Portal",
        absolutePath: "/tmp/project",
        daemonId: null,
        gitStatus: "unknown",
        blockedReason: null,
        enabledWorkflowIds: [],
        setupCommand: null,
      });
    },
    { preconnect: originalFetch.preconnect },
  );

  const workspace = new HttpProjectWorkspaceAdapter("https://factory.example");
  await workspace.setProjectName("project-1", "Portal");

  expect(seen).toEqual([
    {
      url: "https://factory.example/v1/projects/project-1/name",
      body: { name: "Portal" },
    },
  ]);
});
