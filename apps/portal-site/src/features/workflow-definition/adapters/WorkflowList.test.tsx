import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { WorkflowDefinition } from "@factory/workflow";
import { WorkflowList } from "./WorkflowList";

const workflows: WorkflowDefinition[] = [
  {
    workflowId: "build",
    name: "Build a feature",
    description: "Turn an agreed goal into a tested implementation.",
    activities: [
      { activityId: "plan", name: "Plan", description: "", instructions: "Plan", execution: { kind: "agent", harness: "codex", model: "gpt-5.6-sol", effort: "medium" }, humanInput: "approval", outcomes: [] },
      { activityId: "build", name: "Build", description: "", instructions: "Build", execution: { kind: "agent", harness: "codex", model: "gpt-5.6-sol", effort: "medium" }, humanInput: "off", outcomes: [] },
    ],
    positions: {},
  },
];

test("workflow list links to workflow detail and shows description plus step count", async () => {
  const rootRoute = createRootRoute({ component: () => <WorkflowList definitions={workflows} onDelete={() => {}} /> });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);

  expect(html).toContain("Build a feature");
  expect(html).toContain("Turn an agreed goal into a tested implementation.");
  expect(html).toContain('aria-label="2 steps"');
  expect(html).toContain('aria-label="View workflow: Build a feature"');
  expect(html).toContain('aria-label="Delete workflow: Build a feature"');
  expect(html).toContain("/workflows/build");
  expect(html).not.toContain("Edit graph");
});

test("workflow list renders legacy definitions without descriptions", async () => {
  const legacyWorkflow = JSON.parse(`{
    "workflowId": "legacy-workflow",
    "name": "Summarise",
    "activities": [],
    "positions": {}
  }`);
  const rootRoute = createRootRoute({ component: () => <WorkflowList definitions={[legacyWorkflow]} onDelete={() => {}} /> });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);

  expect(html).toContain("Summarise");
  expect(html).toContain("No description yet.");
});
