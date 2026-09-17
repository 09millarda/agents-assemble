import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { setProjectName } from "../../../../features/project-workspace/application/commands/setProjectName";
import type { ProjectRegistryPort } from "../../../../features/project-workspace/domain/ProjectWorkspacePort";
import {
  ProjectDtoSchema,
  ProjectNameBodySchema,
} from "../../../../features/project-workspace/adapters/inbound/dto/projectDto";
import { ProblemDetailSchema } from "../../../../infrastructure/http/problemDetails";
import { projectProblemResponse } from "../projectProblem";

const setProjectNameRoute = createRoute({
  method: "post",
  path: "/v1/projects/{projectId}/name",
  request: {
    params: z.object({ projectId: z.string().min(1) }),
    body: { content: { "application/json": { schema: ProjectNameBodySchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: ProjectDtoSchema } }, description: "Updated project name." },
    400: { content: { "application/problem+json": { schema: ProblemDetailSchema } }, description: "Invalid project name." },
    404: { content: { "application/problem+json": { schema: ProblemDetailSchema } }, description: "Unknown project." },
    422: { content: { "application/problem+json": { schema: ProblemDetailSchema } }, description: "Validation failed." },
  },
});

export function registerSetProjectNameRoute(
  app: OpenAPIHono,
  dependencies: { registry: ProjectRegistryPort },
): void {
  app.openapi(setProjectNameRoute, (async (context) => {
    const result = await setProjectName(
      dependencies.registry,
      context.req.valid("param").projectId,
      context.req.valid("json").name,
    );
    if (!result.ok) return projectProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof setProjectNameRoute>);
}
