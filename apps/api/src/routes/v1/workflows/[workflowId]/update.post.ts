import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { updateWorkflowDefinition } from "../../../../features/workflow-management/application/commands/updateWorkflowDefinition";
import type { WorkflowStorePort } from "../../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../../workflowProblem";

const updateWorkflowDefinitionRoute = createRoute({
  method: "post",
  path: "/v1/workflows/{workflowId}/update",
  request: {
    params: z.object({ workflowId: z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: dto.WorkflowDefinitionInputSchema } },
    },
  },
  responses: workflowResponseSchemas(dto.WorkflowDefinitionSchema),
});

export function registerUpdateWorkflowDefinitionRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(updateWorkflowDefinitionRoute, (async (context) => {
    const result = await updateWorkflowDefinition(
      dependencies.store,
      context.req.valid("param").workflowId,
      context.req.valid("json"),
    );
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof updateWorkflowDefinitionRoute>);
}
