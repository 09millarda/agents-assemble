import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { assignDaemonToProject } from "../../../../features/project-workspace/application/commands/assignDaemonToProject";
import type { ProjectRegistryPort } from "../../../../features/project-workspace/domain/ProjectWorkspacePort";
import {
  AssignDaemonBodySchema,
  ProjectDtoSchema,
} from "../../../../features/project-workspace/adapters/inbound/dto/projectDto";
import { ProblemDetailSchema } from "../../../../infrastructure/http/problemDetails";
import { projectProblemResponse } from "../projectProblem";

const assignDaemonRoute = createRoute({
  method: "post",
  path: "/v1/projects/{projectId}/assign",
  request: {
    params: z.object({ projectId: z.string().min(1) }),
    body: { content: { "application/json": { schema: AssignDaemonBodySchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: ProjectDtoSchema } }, description: "Assigned daemon." },
    404: { content: { "application/problem+json": { schema: ProblemDetailSchema } }, description: "Unknown project." },
    422: { content: { "application/problem+json": { schema: ProblemDetailSchema } }, description: "Validation failed." },
  },
});

export function registerAssignDaemonRoute(
  app: OpenAPIHono,
  dependencies: { registry: ProjectRegistryPort },
): void {
  app.openapi(assignDaemonRoute, (async (context) => {
    const result = await assignDaemonToProject(
      dependencies.registry,
      context.req.valid("param").projectId,
      context.req.valid("json").daemonId,
    );
    if (!result.ok) return projectProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof assignDaemonRoute>);
}
