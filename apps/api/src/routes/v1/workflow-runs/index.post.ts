import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { startWorkflowRun } from "../../../features/workflow-management/application/commands/startWorkflowRun";
import type { WorkflowStorePort } from "../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../workflowProblem";

const startWorkflowRunRoute = createRoute({
  method: "post",
  path: "/v1/workflow-runs",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: dto.StartWorkflowRunSchema } },
    },
  },
  responses: workflowResponseSchemas(dto.WorkflowRunSchema),
});

export function registerStartWorkflowRunRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(startWorkflowRunRoute, (async (context) => {
    const input = context.req.valid("json");
    const result = await startWorkflowRun(dependencies.store, input);
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    context.header("Location", `/v1/workflow-runs/${input.requestId}`);
    return context.json(result.value, 201);
  }) as RouteHandler<typeof startWorkflowRunRoute>);
}
