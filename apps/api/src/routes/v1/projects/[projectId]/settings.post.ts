import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { setProjectSetupCommand } from "../../../../features/project-workspace/application/commands/setProjectSetupCommand";
import type { ProjectRegistryPort } from "../../../../features/project-workspace/domain/ProjectWorkspacePort";
import {
  ProjectDtoSchema,
  ProjectSettingsBodySchema,
} from "../../../../features/project-workspace/adapters/inbound/dto/projectDto";
import { ProblemDetailSchema } from "../../../../infrastructure/http/problemDetails";
import { projectProblemResponse } from "../projectProblem";

const setProjectSettingsRoute = createRoute({
  method: "post",
  path: "/v1/projects/{projectId}/settings",
  request: {
    params: z.object({ projectId: z.string().min(1) }),
    body: { content: { "application/json": { schema: ProjectSettingsBodySchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: ProjectDtoSchema } }, description: "Updated project settings." },
    404: { content: { "application/problem+json": { schema: ProblemDetailSchema } }, description: "Unknown project." },
    422: { content: { "application/problem+json": { schema: ProblemDetailSchema } }, description: "Validation failed." },
  },
});

export function registerSetProjectSettingsRoute(
  app: OpenAPIHono,
  dependencies: { registry: ProjectRegistryPort },
): void {
  app.openapi(setProjectSettingsRoute, (async (context) => {
    const result = await setProjectSetupCommand(
      dependencies.registry,
      context.req.valid("param").projectId,
      context.req.valid("json").setupCommand,
    );
    if (!result.ok) return projectProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof setProjectSettingsRoute>);
}
