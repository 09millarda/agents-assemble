import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { deleteWorkflowRun } from "../../../features/workflow-management/application/commands/deleteWorkflowRun";
import type { WorkflowStorePort } from "../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../workflowProblem";

const deleteWorkflowRunRoute = createRoute({
  method: "delete",
  path: "/v1/workflow-runs/{runId}",
  request: { params: z.object({ runId: z.string().min(1) }) },
  responses: workflowResponseSchemas(dto.DeletedWorkflowSchema),
});

export function registerDeleteWorkflowRunRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(deleteWorkflowRunRoute, (async (context) => {
    const result = await deleteWorkflowRun(dependencies.store, context.req.valid("param").runId);
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof deleteWorkflowRunRoute>);
}
