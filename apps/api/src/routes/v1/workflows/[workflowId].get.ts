import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { getWorkflowDefinition } from "../../../features/workflow-management/application/queries/getWorkflowDefinition";
import type { WorkflowStorePort } from "../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../workflowProblem";

const getWorkflowDefinitionRoute = createRoute({
  method: "get",
  path: "/v1/workflows/{workflowId}",
  request: { params: z.object({ workflowId: z.string().min(1) }) },
  responses: workflowResponseSchemas(dto.WorkflowDefinitionSchema),
});

export function registerGetWorkflowDefinitionRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(getWorkflowDefinitionRoute, (async (context) => {
    const result = await getWorkflowDefinition(
      dependencies.store,
      context.req.valid("param").workflowId,
    );
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof getWorkflowDefinitionRoute>);
}
