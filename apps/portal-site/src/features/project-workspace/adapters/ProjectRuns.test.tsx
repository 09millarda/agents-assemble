import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { WorkflowRun } from "@factory/workflow";
import { ProjectRuns } from "./ProjectRuns";

async function renderWithRouter(runs: WorkflowRun[]): Promise<string> {
  const rootRoute = createRootRoute({ component: () => <ProjectRuns runs={runs} /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

function createRun(
  runId: string,
  name: string,
  status: WorkflowRun["status"],
  updatedAt: string,
): WorkflowRun {
  return {
    runId,
    name,
    projectId: "project-1",
    workflowId: `${runId}-workflow`,
    daemonId: "daemon-1",
    recipientId: null,
    snapshot: {
      workflowId: `${runId}-workflow`,
      name,
      description: "",
      activities: [],
      positions: {},
    },
    workspace: { projectPath: "/tmp/project" },
    workspaceResult: null,
    kickoffPrompt: null,
    status,
    executions: [],
    documents: [],
    interaction:
      status === "recovery-required"
        ? {
            interactionId: `${runId}-interaction`,
            executionId: `${runId}-execution`,
            kind: "recovery",
            prompt: "Choose how to recover this run.",
            outputRevisionIds: [],
            targetActivityId: null,
          }
        : null,
    loopPasses: {},
    loopLimits: {},
    processedMessageIds: [],
    approvedTreeHash: null,
    acceptedFindings: false,
    acceptedFindingRevisionIds: [],
    publication: null,
    error: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

test("groups attention-needed and active runs before terminal history", async () => {
  const html = await renderWithRouter([
    createRun("history", "Finished build", "completed", "2026-09-15T10:00:00.000Z"),
    createRun("running", "Current build", "running", "2026-09-16T10:00:00.000Z"),
    createRun("recovery", "Blocked build", "recovery-required", "2026-09-16T11:00:00.000Z"),
  ]);

  expect(html.indexOf("Needs attention")).toBeGreaterThanOrEqual(0);
  expect(html.indexOf("Blocked build")).toBeLessThan(html.indexOf("Current build"));
  expect(html.indexOf("Current build")).toBeLessThan(html.indexOf("Run history"));
  expect(html).toContain("Choose how to recover this run.");
  expect(html).toContain("Finished build");
});

test("shows a useful empty state when a project has no runs", async () => {
  const html = await renderWithRouter([]);

  expect(html).toContain("No active runs");
  expect(html).toContain("No run history yet");
});
