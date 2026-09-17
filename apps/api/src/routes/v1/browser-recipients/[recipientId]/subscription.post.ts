import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { replaceBrowserSubscription } from "../../../../features/workflow-management/application/commands/replaceBrowserSubscription";
import type { WorkflowStorePort } from "../../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../../workflowProblem";

const replaceBrowserSubscriptionRoute = createRoute({
  method: "post",
  path: "/v1/browser-recipients/{recipientId}/subscription",
  request: {
    params: z.object({ recipientId: z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: dto.SubscriptionBodySchema } },
    },
  },
  responses: workflowResponseSchemas(dto.BrowserRecipientSchema),
});

export function registerReplaceBrowserSubscriptionRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(replaceBrowserSubscriptionRoute, (async (context) => {
    const input = context.req.valid("json");
    const result = await replaceBrowserSubscription(
      dependencies.store,
      context.req.valid("param").recipientId,
      input.managementToken,
      input.subscription,
    );
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof replaceBrowserSubscriptionRoute>);
}
