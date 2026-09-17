import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { WorkflowDefinition } from "@factory/workflow";
import { WorkflowDetail } from "./WorkflowDetail";

const definition: WorkflowDefinition = {
  workflowId: "build",
  name: "Build a feature",
  description: "Turn an agreed goal into a tested implementation.",
  activities: [
    {
      activityId: "plan",
      name: "Plan",
      description: "Plan the work.",
      instructions: "Plan the work.",
      execution: { kind: "agent", harness: "codex", model: "gpt-5.6-sol", effort: "medium" },
      humanInput: "approval",
      outcomes: [{ name: "ready", handoff: { targetActivityId: null, continuation: "approval" } }],
    },
  ],
  positions: { plan: { x: 40, y: 40 } },
};

test("workflow detail shows metadata, a read-only graph, and an explicit edit action", async () => {
  const rootRoute = createRootRoute({ component: () => <WorkflowDetail definition={definition} onDelete={() => {}} /> });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);

  for (const text of [
    "Build a feature",
    "Turn an agreed goal into a tested implementation.",
    "Workflow graph",
    "Edit workflow",
    "Delete workflow",
    "Back to workflows",
    "Plan",
  ]) {
    expect(html).toContain(text);
  }
  expect(html).toContain("/workflows/build/edit");
  expect(html).not.toContain("Add step");
  expect(html).not.toContain("Save workflow");
});
