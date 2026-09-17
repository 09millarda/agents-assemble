import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { listDaemons } from "../../../features/daemon-connection/application/queries/listDaemons";
import type { DaemonPresencePort, DaemonRegistryPort } from "../../../features/daemon-connection/domain/DaemonConnectionPort";
import { ProblemDetailSchema } from "../../../infrastructure/http/problemDetails";
import {
  DaemonListResponseSchema,
  ListDaemonsQuerySchema,
} from "../../../features/daemon-connection/adapters/inbound/dto/daemonDto";

const listDaemonsRoute = createRoute({
  method: "get",
  path: "/v1/daemons",
  request: { query: ListDaemonsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: DaemonListResponseSchema } },
      description: "Paged daemon summaries in stable id order.",
    },
    422: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Invalid pagination query.",
    },
  },
});

function setNextPageLink(
  context: Context,
  limit: number,
  nextCursor: string,
): void {
  const next = new URL(context.req.url);
  next.searchParams.set("limit", String(limit));
  next.searchParams.set("cursor", nextCursor);
  context.header("Link", `<${next.pathname}${next.search}>; rel="next"`);
}

export function registerListDaemonsRoute(
  app: OpenAPIHono,
  dependencies: {
    registry: DaemonRegistryPort;
    presence: DaemonPresencePort;
  },
): void {
  app.openapi(listDaemonsRoute, async (context) => {
    const query = context.req.valid("query");
    const page = await listDaemons(dependencies.registry, dependencies.presence, {
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    if (page.pagination.nextCursor) {
      setNextPageLink(context, page.pagination.limit, page.pagination.nextCursor);
    }
    return context.json(page, 200);
  });
}
