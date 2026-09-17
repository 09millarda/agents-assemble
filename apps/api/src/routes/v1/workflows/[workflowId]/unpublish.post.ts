import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { unpublishWorkflowDefinition } from "../../../../features/workflow-management/application/commands/unpublishWorkflowDefinition";
import type { WorkflowStorePort } from "../../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../../workflowProblem";

const unpublishWorkflowDefinitionRoute = createRoute({
  method: "post",
  path: "/v1/workflows/{workflowId}/unpublish",
  request: {
    params: z.object({ workflowId: z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: dto.EmptyRequestSchema } },
    },
  },
  responses: workflowResponseSchemas(dto.WorkflowDefinitionSchema),
});

export function registerUnpublishWorkflowDefinitionRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(unpublishWorkflowDefinitionRoute, (async (context) => {
    const result = await unpublishWorkflowDefinition(
      dependencies.store,
      context.req.valid("param").workflowId,
    );
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof unpublishWorkflowDefinitionRoute>);
}
