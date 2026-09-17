import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import type { WorkflowStorePort } from "../../../features/workflow-management/domain/WorkflowStorePort";
import { listWorkflowDefinitions } from "../../../features/workflow-management/application/queries/listWorkflowDefinitions";
import * as dto from "../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { pageWorkflowItems } from "../workflowPagination";
import { workflowResponseSchemas } from "../workflowProblem";

const listWorkflowDefinitionsRoute = createRoute({
  method: "get",
  path: "/v1/workflows",
  request: { query: dto.ListQuerySchema },
  responses: workflowResponseSchemas(dto.collectionSchema(dto.WorkflowDefinitionSchema)),
});

export function registerListWorkflowDefinitionsRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(listWorkflowDefinitionsRoute, (async (context) => {
    const query = context.req.valid("query");
    const page = pageWorkflowItems(
      await listWorkflowDefinitions(dependencies.store),
      (item) => item.workflowId,
      query.limit,
      query.cursor,
      context,
    );
    return context.json(page, 200);
  }) as RouteHandler<typeof listWorkflowDefinitionsRoute>);
}
