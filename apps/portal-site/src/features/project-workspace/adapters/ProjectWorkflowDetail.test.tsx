import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { ProjectInfo } from "@factory/shared-domain";
import { ProjectWorkflowDetailView } from "./ProjectWorkflowDetail";

const project: ProjectInfo = {
  projectId: "project-1",
  name: "Portal",
  absolutePath: "/home/example/portal",
  daemonId: "daemon-1",
  gitStatus: "valid",
  blockedReason: null,
  enabledWorkflowIds: ["workflow-1"],
};

async function renderProjectDetail(): Promise<string> {
  const rootRoute = createRootRoute({
    component: () => (
      <ProjectWorkflowDetailView project={project} history={[]} message={null} />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

test("project detail links to a dedicated start page without rendering the old form", async () => {
  const html = await renderProjectDetail();

  expect(html).toContain('href="/projects/project-1/runs/new"');
  expect(html).toContain("Start run");
  expect(html).not.toContain("Start a run");
  expect(html).not.toContain("Optional kickoff prompt");
  expect(html).not.toContain("Local starting branch (optional)");
  expect(html).not.toContain('id="start-workflow"');
});
