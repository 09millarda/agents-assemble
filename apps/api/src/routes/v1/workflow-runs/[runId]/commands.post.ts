import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { submitHumanResponse } from "../../../../features/workflow-management/application/commands/submitHumanResponse";
import type { WorkflowStorePort } from "../../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../../workflowProblem";

const submitHumanResponseRoute = createRoute({
  method: "post",
  path: "/v1/workflow-runs/{runId}/commands",
  request: {
    params: z.object({ runId: z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: dto.HumanResponseSchema } },
    },
  },
  responses: workflowResponseSchemas(dto.AcceptedMessageSchema),
});

export function registerSubmitHumanResponseRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(submitHumanResponseRoute, (async (context) => {
    const result = await submitHumanResponse(dependencies.store, {
      ...context.req.valid("json"),
      runId: context.req.valid("param").runId,
    });
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof submitHumanResponseRoute>);
}
