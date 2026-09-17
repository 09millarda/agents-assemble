import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { listHumanInteractions } from "../../../../features/workflow-management/application/queries/listHumanInteractions";
import type { WorkflowStorePort } from "../../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { pageWorkflowItems } from "../../workflowPagination";
import { workflowProblemResponse, workflowResponseSchemas } from "../../workflowProblem";

const listHumanInteractionsRoute = createRoute({
  method: "get",
  path: "/v1/workflow-runs/{runId}/human-interactions",
  request: {
    params: z.object({ runId: z.string().min(1) }),
    query: dto.ListQuerySchema,
  },
  responses: workflowResponseSchemas(dto.collectionSchema(dto.HumanInteractionSchema)),
});

export function registerListHumanInteractionsRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(listHumanInteractionsRoute, (async (context) => {
    const query = context.req.valid("query");
    const result = await listHumanInteractions(dependencies.store, context.req.valid("param").runId);
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(pageWorkflowItems(result.value, (item) => item.interactionId, query.limit, query.cursor, context), 200);
  }) as RouteHandler<typeof listHumanInteractionsRoute>);
}
