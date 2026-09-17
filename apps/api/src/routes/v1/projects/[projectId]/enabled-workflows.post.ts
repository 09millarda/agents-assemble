import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { setEnabledWorkflowIds } from "../../../../features/project-workspace/application/commands/setEnabledWorkflowIds";
import type { ProjectRegistryPort } from "../../../../features/project-workspace/domain/ProjectWorkspacePort";
import {
  ProjectDtoSchema,
  SetEnabledWorkflowIdsBodySchema,
} from "../../../../features/project-workspace/adapters/inbound/dto/projectDto";
import { ProblemDetailSchema } from "../../../../infrastructure/http/problemDetails";
import { projectProblemResponse } from "../projectProblem";

const setEnabledWorkflowsRoute = createRoute({
  method: "post",
  path: "/v1/projects/{projectId}/enabled-workflows",
  request: {
    params: z.object({ projectId: z.string().min(1) }),
    body: { content: { "application/json": { schema: SetEnabledWorkflowIdsBodySchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: ProjectDtoSchema } }, description: "Replaced the enabled-workflow allow-list." },
    404: { content: { "application/problem+json": { schema: ProblemDetailSchema } }, description: "Unknown project." },
    422: { content: { "application/problem+json": { schema: ProblemDetailSchema } }, description: "Validation failed." },
  },
});

export function registerSetEnabledWorkflowsRoute(
  app: OpenAPIHono,
  dependencies: { registry: ProjectRegistryPort },
): void {
  app.openapi(setEnabledWorkflowsRoute, (async (context) => {
    const result = await setEnabledWorkflowIds(
      dependencies.registry,
      context.req.valid("param").projectId,
      context.req.valid("json").workflowIds,
    );
    if (!result.ok) return projectProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof setEnabledWorkflowsRoute>);
}
