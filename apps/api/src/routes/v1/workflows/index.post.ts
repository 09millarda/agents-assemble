import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { saveWorkflowDefinition } from "../../../features/workflow-management/application/commands/saveWorkflowDefinition";
import type { WorkflowStorePort } from "../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../workflowProblem";

const saveWorkflowDefinitionRoute = createRoute({
  method: "post",
  path: "/v1/workflows",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: dto.WorkflowDefinitionInputSchema } },
    },
  },
  responses: workflowResponseSchemas(dto.WorkflowDefinitionSchema),
});

export function registerSaveWorkflowDefinitionRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(saveWorkflowDefinitionRoute, (async (context) => {
    const input = context.req.valid("json");
    const result = await saveWorkflowDefinition(dependencies.store, input);
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    context.header("Location", `/v1/workflows/${input.workflowId}`);
    return context.json(result.value, 201);
  }) as RouteHandler<typeof saveWorkflowDefinitionRoute>);
}
