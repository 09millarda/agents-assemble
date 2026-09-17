import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { deleteWorkflowDefinition } from "../../../../features/workflow-management/application/commands/deleteWorkflowDefinition";
import type { WorkflowStorePort } from "../../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../../workflowProblem";

const deleteWorkflowDefinitionRoute = createRoute({
  method: "post",
  path: "/v1/workflows/{workflowId}/delete",
  request: {
    params: z.object({ workflowId: z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: dto.EmptyRequestSchema } },
    },
  },
  responses: workflowResponseSchemas(dto.DeletedWorkflowSchema),
});

export function registerDeleteWorkflowDefinitionRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(deleteWorkflowDefinitionRoute, (async (context) => {
    const result = await deleteWorkflowDefinition(
      dependencies.store,
      context.req.valid("param").workflowId,
    );
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof deleteWorkflowDefinitionRoute>);
}
