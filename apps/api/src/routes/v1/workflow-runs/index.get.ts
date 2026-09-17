import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { listWorkflowRuns } from "../../../features/workflow-management/application/queries/listWorkflowRuns";
import type { WorkflowStorePort } from "../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { pageWorkflowItems } from "../workflowPagination";
import { workflowResponseSchemas } from "../workflowProblem";

const listWorkflowRunsRoute = createRoute({
  method: "get",
  path: "/v1/workflow-runs",
  request: { query: dto.ListQuerySchema },
  responses: workflowResponseSchemas(dto.collectionSchema(dto.WorkflowRunSchema)),
});

export function registerListWorkflowRunsRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(listWorkflowRunsRoute, (async (context) => {
    const query = context.req.valid("query");
    const page = pageWorkflowItems(
      await listWorkflowRuns(dependencies.store, query.projectId),
      (item) => item.runId,
      query.limit,
      query.cursor,
      context,
    );
    return context.json(page, 200);
  }) as RouteHandler<typeof listWorkflowRunsRoute>);
}
