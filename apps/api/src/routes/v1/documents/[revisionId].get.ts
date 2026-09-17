import { OpenAPIHono, createRoute, type RouteHandler } from "@hono/zod-openapi";
import { z } from "zod";
import { getContextDocument } from "../../../features/workflow-management/application/queries/getContextDocument";
import type { WorkflowStorePort } from "../../../features/workflow-management/domain/WorkflowStorePort";
import * as dto from "../../../features/workflow-management/adapters/inbound/dto/workflowDto";
import { workflowProblemResponse, workflowResponseSchemas } from "../workflowProblem";

const getContextDocumentRoute = createRoute({
  method: "get",
  path: "/v1/documents/{revisionId}",
  request: { params: z.object({ revisionId: z.string().min(1) }) },
  responses: workflowResponseSchemas(dto.DocumentRevisionSchema),
});

export function registerGetContextDocumentRoute(
  app: OpenAPIHono,
  dependencies: { store: WorkflowStorePort },
): void {
  app.openapi(getContextDocumentRoute, (async (context) => {
    const result = await getContextDocument(dependencies.store, context.req.valid("param").revisionId);
    if (!result.ok) return workflowProblemResponse(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  }) as RouteHandler<typeof getContextDocumentRoute>);
}
