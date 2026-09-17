import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { publishWorkflowDefinition } from "../../../../features/workflow-management/application/commands/publishWorkflowDefinition";
import type { WorkflowStorePort } from "../../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../../workflowProblem";

const publishWorkflowDefinitionRoute = createRoute({
  method: "post",
  path: "/v1/workflows/{workflowId}/publish",
  request: {
    params: z.object({ workflowId: z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: dto.EmptyRequestSchema } },
    },
  },
  responses: workflowResponseSchemas(dto.WorkflowDefinitionSchema),
});

export function registerPublishWorkflowDefinitionRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(publishWorkflowDefinitionRoute, (async (context) => {
    const result = await publishWorkflowDefinition(
      dependencies.store,
      context.req.valid("param").workflowId,
    );
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof publishWorkflowDefinitionRoute>);
}
