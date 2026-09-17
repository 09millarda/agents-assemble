import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { createBrowserRecipient } from "../../../features/workflow-management/application/commands/createBrowserRecipient";
import type { WorkflowStorePort } from "../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../workflowProblem";

const createBrowserRecipientRoute = createRoute({
  method: "post",
  path: "/v1/browser-recipients",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: dto.EmptyRequestSchema } },
    },
  },
  responses: workflowResponseSchemas(dto.NewBrowserRecipientSchema),
});

export function registerCreateBrowserRecipientRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(createBrowserRecipientRoute, (async (context) => {
    const browser = await createBrowserRecipient(dependencies.store);
    context.header("Location", `/v1/browser-recipients/${browser.recipientId}`);
    return context.json(browser, 201);
  }) as RouteHandler<typeof createBrowserRecipientRoute>);
}
