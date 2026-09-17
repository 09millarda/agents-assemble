import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { getWorkflowRun } from "../../../features/workflow-management/application/queries/getWorkflowRun";
import type { WorkflowStorePort } from "../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../workflowProblem";

const getWorkflowRunRoute = createRoute({
  method: "get",
  path: "/v1/workflow-runs/{runId}",
  request: { params: z.object({ runId: z.string().min(1) }) },
  responses: workflowResponseSchemas(dto.WorkflowRunSchema),
});

export function registerGetWorkflowRunRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(getWorkflowRunRoute, (async (context) => {
    const result = await getWorkflowRun(dependencies.store, context.req.valid("param").runId);
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof getWorkflowRunRoute>);
}
