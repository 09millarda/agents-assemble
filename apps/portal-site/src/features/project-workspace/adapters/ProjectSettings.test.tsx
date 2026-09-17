import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { DaemonSummary, ProjectInfo } from "@factory/shared-domain";
import type { WorkflowDefinition } from "@factory/workflow";
import type { ProjectWorkspacePort } from "../domain/ProjectWorkspacePort";
import { ProjectSettings } from "./ProjectSettings";

const project: ProjectInfo = {
  projectId: "project-1",
  name: "Portal",
  absolutePath: "/home/example/portal",
  daemonId: "daemon-1",
  gitStatus: "valid",
  blockedReason: null,
  enabledWorkflowIds: ["workflow-1"],
  setupCommand: "pnpm install",
};

const workflows: WorkflowDefinition[] = [
  { workflowId: "workflow-1", name: "Build a feature", description: "", activities: [], positions: {} },
  { workflowId: "workflow-2", name: "Summarise", description: "", activities: [], positions: {} },
];

const daemons: DaemonSummary[] = [
  { daemonId: "daemon-1", machineName: "studio", status: "online" },
];

const workspace: ProjectWorkspacePort = {
  listProjects: async () => [project],
  createProject: async () => project,
  setProjectName: async (_projectId, name) => ({ ...project, name }),
  assignDaemon: async () => project,
  setEnabledWorkflowIds: async () => project,
  setSettings: async () => project,
};

async function renderSettings(): Promise<string> {
  const rootRoute = createRootRoute({
    component: () => (
      <ProjectSettings
        project={project}
        daemons={daemons}
        definitions={workflows}
        workspace={workspace}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

test("settings exposes project identity, daemon, setup, and enabled workflows", async () => {
  const html = await renderSettings();

  for (const label of [
    "Project settings",
    "Project name",
    "Project path",
    "Daemon assignment",
    "Setup command",
    "Enabled workflows",
    "Save project name",
    "Assign daemon",
    "Save setup command",
    "Save enabled workflows",
  ]) {
    expect(html).toContain(label);
  }
  expect(html).toContain('readOnly=""');
  expect(html).toContain(project.absolutePath);
});
