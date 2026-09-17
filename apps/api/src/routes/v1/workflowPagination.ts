import type { Context } from "hono";
import { paginateById } from "../../infrastructure/http/pagination";

export function pageWorkflowItems<Item>(
  items: Item[],
  pickId: (item: Item) => string,
  limit: number,
  cursor: string | undefined,
  context: Context,
) {
  const sorted = [...items].sort((left, right) => pickId(left).localeCompare(pickId(right)));
  const page = paginateById(sorted, pickId, limit, cursor ?? null);
  if (page.pagination.nextCursor) {
    const next = new URL(context.req.url);
    next.searchParams.set("limit", String(limit));
    next.searchParams.set("cursor", page.pagination.nextCursor);
    context.header("Link", `<${next.pathname}${next.search}>; rel="next"`);
  }
  return page;
}
