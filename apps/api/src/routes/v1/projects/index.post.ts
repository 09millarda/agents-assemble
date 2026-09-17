import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { createProject } from "../../../features/project-workspace/application/commands/createProject";
import type { ProjectRegistryPort } from "../../../features/project-workspace/domain/ProjectWorkspacePort";
import {
  CreateProjectBodySchema,
  ProjectDtoSchema,
} from "../../../features/project-workspace/adapters/inbound/dto/projectDto";
import { ProblemDetailSchema } from "../../../infrastructure/http/problemDetails";
import { projectProblemResponse } from "./projectProblem";

const createProjectRoute = createRoute({
  method: "post",
  path: "/v1/projects",
  request: { body: { content: { "application/json": { schema: CreateProjectBodySchema } } } },
  responses: {
    201: {
      content: { "application/json": { schema: ProjectDtoSchema } },
      description: "Created project.",
    },
    400: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Invalid path or name.",
    },
    422: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Validation failed.",
    },
  },
});

export function registerCreateProjectRoute(
  app: OpenAPIHono,
  dependencies: { registry: ProjectRegistryPort },
): void {
  app.openapi(createProjectRoute, (async (context) => {
    const result = await createProject(dependencies.registry, context.req.valid("json"));
    if (!result.ok) return projectProblemResponse(context, result.error.code, result.error.message);
    context.header("Location", `/v1/projects/${result.value.projectId}`);
    return context.json(result.value, 201);
  }) as RouteHandler<typeof createProjectRoute>);
}
