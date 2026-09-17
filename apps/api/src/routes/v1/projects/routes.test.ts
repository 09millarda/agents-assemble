import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { ProjectRegistryPort } from "../../../features/project-workspace/domain/ProjectWorkspacePort";
import { validationHook } from "../../../infrastructure/http/validationHook";
import { registerAssignDaemonRoute } from "./[projectId]/assign.post";
import { registerSetEnabledWorkflowsRoute } from "./[projectId]/enabled-workflows.post";
import { registerSetProjectNameRoute } from "./[projectId]/name.post";
import { registerSetProjectSettingsRoute } from "./[projectId]/settings.post";
import { registerListProjectsRoute } from "./index.get";
import { registerCreateProjectRoute } from "./index.post";

const project = {
  projectId: "project-1",
  name: "Portal",
  absolutePath: "/tmp/project",
  daemonId: "daemon-1",
  gitStatus: "unknown" as const,
  blockedReason: null,
  enabledWorkflowIds: [],
  setupCommand: null,
};

function buildProjectRoutes(): OpenAPIHono {
  const registry: ProjectRegistryPort = {
    createProject: async (input) => ({ ...project, name: input.name, absolutePath: input.absolutePath }),
    listProjects: async () => [project],
    findProject: async () => project,
    setProjectName: async (_projectId, name) => ({ ...project, name }),
    assignDaemon: async (_projectId, daemonId) => ({ ...project, daemonId }),
    setEnabledWorkflowIds: async (_projectId, workflowIds) => ({ ...project, enabledWorkflowIds: workflowIds }),
    setSetupCommand: async (_projectId, setupCommand) => ({ ...project, setupCommand }),
    markGitStatus: async () => {},
  };
  const app = new OpenAPIHono({ defaultHook: validationHook });
  registerCreateProjectRoute(app, { registry });
  registerListProjectsRoute(app, { registry });
  registerSetProjectNameRoute(app, { registry });
  registerAssignDaemonRoute(app, { registry });
  registerSetEnabledWorkflowsRoute(app, { registry });
  registerSetProjectSettingsRoute(app, { registry });
  return app;
}

test("POST /v1/projects creates a project and returns its location", async () => {
  const response = await buildProjectRoutes().request("/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Portal", absolutePath: "/tmp/project" }),
  });

  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toBe("/v1/projects/project-1");
  expect(await response.json()).toMatchObject({ projectId: "project-1", name: "Portal" });
});

test("GET /v1/projects returns a cursor-paged collection", async () => {
  const response = await buildProjectRoutes().request("/v1/projects?limit=1");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: [project],
    pagination: { nextCursor: null, limit: 1 },
  });
});

test("project command routes return their updated project DTOs", async () => {
  const app = buildProjectRoutes();
  const requests = [
    ["/v1/projects/project-1/name", { name: "Renamed" }],
    ["/v1/projects/project-1/assign", { daemonId: "daemon-2" }],
    ["/v1/projects/project-1/enabled-workflows", { workflowIds: ["build"] }],
    ["/v1/projects/project-1/settings", { setupCommand: "pnpm install" }],
  ] as const;

  for (const [path, body] of requests) {
    const response = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).projectId).toBe("project-1");
  }
});

test("project validation failures return problem details", async () => {
  const response = await buildProjectRoutes().request("/v1/projects?limit=500");

  expect(response.status).toBe(422);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED", instance: "/v1/projects" });
});
