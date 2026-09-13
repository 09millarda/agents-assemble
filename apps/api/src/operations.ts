import { ContextName } from "@aa/platform/contracts";
import type { ApiRouter } from "@aa/platform/http";
import type { ContextStore } from "@aa/platform/store";
import { z } from "zod";
export function registerOperations(router: ApiRouter, stores: Record<ContextName, ContextStore>) {
  router.add({
    method: "get",
    path: "/operations/:context/messages",
    params: z.strictObject({ context: ContextName }),
    summary: "Inspect scoped delivery failures without exposing message payloads",
    auth: "admin",
    query: z.strictObject({
      after: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    response: z.strictObject({
      items: z.array(
        z.strictObject({
          id: z.uuid(),
          type: z.string(),
          aggregateId: z.uuid(),
          sequence: z.number(),
          attempts: z.number(),
          poison: z.boolean(),
          error: z.string().nullable(),
          deliveredAt: z.iso.datetime().nullable(),
        }),
      ),
    }),
    handler: async (req) => ({
      items: (
        await stores[ContextName.parse(req.params.context)].messages(req.actor.organizationId, {
          ...req.query,
          pendingOnly: true,
        })
      ).map((row) => ({
        id: row.message.id,
        type: row.message.type,
        aggregateId: row.message.aggregateId,
        sequence: row.message.sequence,
        attempts: row.attempts,
        poison: row.poison,
        error: row.error,
        deliveredAt: row.deliveredAt,
      })),
    }),
  });
  router.add({
    method: "post",
    path: "/operations/:context/messages/:id/retry",
    params: z.strictObject({ context: ContextName, id: z.uuid() }),
    summary: "Retry the original immutable message with a recorded operator decision",
    auth: "admin",
    body: z.strictObject({ expectedAttempts: z.int().min(0), reason: z.string().min(1).max(2000) }),
    response: z.strictObject({ status: z.literal("pending"), receiptId: z.uuid() }),
    handler: (req) =>
      stores[ContextName.parse(req.params.context)].command(
        req.command("retry-delivery", { id: req.params.id, ...req.body }),
        (tx) => tx.retryDelivery(req.params.id, req.body.expectedAttempts, req.body.reason),
      ),
  });
}
