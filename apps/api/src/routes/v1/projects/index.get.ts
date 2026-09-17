import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { listProjects } from "../../../features/project-workspace/application/queries/listProjects";
import type { ProjectRegistryPort } from "../../../features/project-workspace/domain/ProjectWorkspacePort";
import {
  ListProjectsQuerySchema,
  ProjectListResponseSchema,
} from "../../../features/project-workspace/adapters/inbound/dto/projectDto";
import { ProblemDetailSchema } from "../../../infrastructure/http/problemDetails";

const listProjectsRoute = createRoute({
  method: "get",
  path: "/v1/projects",
  request: { query: ListProjectsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: ProjectListResponseSchema } },
      description: "Paged projects.",
    },
    422: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Invalid pagination query.",
    },
  },
});

function setNextPageLink(context: Context, limit: number, nextCursor: string): void {
  const next = new URL(context.req.url);
  next.searchParams.set("limit", String(limit));
  next.searchParams.set("cursor", nextCursor);
  context.header("Link", `<${next.pathname}${next.search}>; rel="next"`);
}

export function registerListProjectsRoute(
  app: OpenAPIHono,
  dependencies: { registry: ProjectRegistryPort },
): void {
  app.openapi(listProjectsRoute, async (context) => {
    const query = context.req.valid("query");
    const page = await listProjects(dependencies.registry, {
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    if (page.pagination.nextCursor) setNextPageLink(context, page.pagination.limit, page.pagination.nextCursor);
    return context.json(page, 200);
  });
}
