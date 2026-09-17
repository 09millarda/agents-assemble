import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { getBrowserRecipient } from "../../../features/workflow-management/application/queries/getBrowserRecipient";
import type { WorkflowStorePort } from "../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../workflowProblem";

const getBrowserRecipientRoute = createRoute({
  method: "get",
  path: "/v1/browser-recipients/{recipientId}",
  request: { params: z.object({ recipientId: z.string().min(1) }) },
  responses: workflowResponseSchemas(dto.BrowserRecipientSchema),
});

export function registerGetBrowserRecipientRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(getBrowserRecipientRoute, (async (context) => {
    const token = context.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    const result = await getBrowserRecipient(
      dependencies.store,
      context.req.valid("param").recipientId,
      token,
    );
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof getBrowserRecipientRoute>);
}
