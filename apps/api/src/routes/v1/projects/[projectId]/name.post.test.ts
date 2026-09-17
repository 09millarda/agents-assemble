import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { ProjectRegistryPort } from "../../../../features/project-workspace/domain/ProjectWorkspacePort";
import { registerSetProjectNameRoute } from "./name.post";

const project = {
  projectId: "project-1",
  name: "Portal",
  absolutePath: "/tmp/project",
  daemonId: null,
  gitStatus: "unknown" as const,
  blockedReason: null,
  enabledWorkflowIds: [],
  setupCommand: null,
};

const registry: ProjectRegistryPort = {
  createProject: async () => project,
  listProjects: async () => [project],
  findProject: async () => project,
  setProjectName: async (_projectId, name) => ({ ...project, name }),
  assignDaemon: async () => project,
  setEnabledWorkflowIds: async () => project,
  setSetupCommand: async () => project,
  markGitStatus: async () => {},
};

test("POST /v1/projects/{projectId}/name returns the renamed project", async () => {
  const app = new OpenAPIHono();
  registerSetProjectNameRoute(app, { registry });

  const response = await app.request("/v1/projects/project-1/name", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Portal" }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ projectId: "project-1", name: "Portal" });
});
