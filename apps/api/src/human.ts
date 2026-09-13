import { type Json, type JsonSchema, validateValue } from "@aa/catalog/definition";
import { DomainError, type Message } from "@aa/platform/contracts";
import { digest } from "@aa/platform/crypto";
import { type ApiRouter, envelope } from "@aa/platform/http";
import { jsonValue } from "@aa/platform/json";
import type { ContextStore } from "@aa/platform/store";
import { z } from "zod";

export const humanRequestSchema = z
  .object({
    runId: z.string().uuid(),
    occurrencePath: z.string(),
    action: z.string(),
    title: z.string(),
    input: jsonValue,
    responseSchema: z.record(z.string(), jsonValue),
    manifestDigest: z.string(),
    deadline: z.string().datetime(),
    authorizationPolicy: z
      .strictObject({
        kind: z.literal("current-organization-membership"),
        minimumRole: z.literal("member"),
      })
      .default({ kind: "current-organization-membership", minimumRole: "member" }),
    expiryPolicy: z.strictObject({ action: z.literal("suspend") }).default({ action: "suspend" }),
    status: z.enum(["pending", "answered", "expired", "superseded"]),
    response: jsonValue.optional(),
    responderId: z.string().uuid().optional(),
    reason: z.string().optional(),
  })
  .strict();
export type HumanRequest = z.infer<typeof humanRequestSchema>;
export class HumanInteraction {
  constructor(readonly store: ContextStore) {}
  async accept(message: Message) {
    return this.store.consume(message, async (tx) => {
      if (message.type === "execution.human_requested") {
        const payload = z
          .object({
            requestId: z.string().uuid(),
            runId: z.string().uuid(),
            occurrencePath: z.string(),
            action: z.string(),
            input: jsonValue,
            responseSchema: z.record(z.string(), jsonValue),
            manifestDigest: z.string(),
            deadline: z.string().datetime(),
          })
          .strict()
          .parse(message.payload);
        const existing = await tx.get<HumanRequest>("request", payload.requestId);
        if (existing) return { accepted: true };
        await tx.put("request", payload.requestId, {
          runId: payload.runId,
          occurrencePath: payload.occurrencePath,
          action: payload.action,
          title: payload.action,
          input: payload.input,
          responseSchema: payload.responseSchema,
          manifestDigest: payload.manifestDigest,
          deadline: payload.deadline,
          authorizationPolicy: { kind: "current-organization-membership", minimumRole: "member" },
          expiryPolicy: { action: "suspend" },
          status: "pending",
        });
      }
      if (message.type === "execution.wait_superseded") {
        const payload = z
          .object({ requestId: z.string().uuid(), reason: z.string() })
          .strict()
          .parse(message.payload);
        const request = await tx.get<HumanRequest>("request", payload.requestId);
        if (request && request.data.status === "pending")
          await tx.put(
            "request",
            request.id,
            { ...request.data, status: "superseded", reason: payload.reason },
            request.version,
          );
      }
      return { accepted: true };
    });
  }
  async tick(organizationId: string) {
    return this.store.schedule(organizationId, "expire-human", async (tx) => {
      const now = await tx.now();
      let expired = 0;
      for (const request of await tx.all<HumanRequest>("request"))
        if (request.data.status === "pending" && new Date(request.data.deadline) <= now) {
          const updated = await tx.put(
            "request",
            request.id,
            {
              ...request.data,
              status: "expired",
              reason: "Deadline expired; no approval was supplied",
            },
            request.version,
          );
          await tx.emit("human.expired", updated, {
            requestId: request.id,
            runId: request.data.runId,
          });
          expired++;
        }
      return { expired };
    });
  }
  register(router: ApiRouter) {
    router.add({
      method: "get",
      path: "/requests",
      summary: "List durable questions and exact approval requests",
      response: z.object({ items: z.array(envelope(humanRequestSchema)) }),
      handler: (req) =>
        this.store.read(req.actor.organizationId, async (tx) => ({
          items: await tx.all<HumanRequest>("request"),
        })),
    });
    router.add({
      method: "get",
      path: "/requests/:id",
      summary: "Read a human request and its immutable binding",
      response: envelope(humanRequestSchema),
      handler: (req) =>
        this.store.read(req.actor.organizationId, (tx) =>
          tx.require<HumanRequest>("request", req.params.id),
        ),
    });
    router.add({
      method: "post",
      path: "/requests/:id/respond",
      summary: "Submit a typed response bound to the exact request and manifest",
      body: z
        .object({
          expectedVersion: z.number().int().positive(),
          manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
          response: jsonValue,
          reason: z.string().min(1).max(2000),
        })
        .strict(),
      response: envelope(humanRequestSchema),
      handler: (req) =>
        this.store.command(
          req.command("respond-human", { id: req.params.id, ...req.body }),
          async (tx) => {
            const request = await tx.require<HumanRequest>("request", req.params.id);
            if (request.version !== req.body.expectedVersion)
              throw new DomainError(
                "stale_request",
                "This request changed; refresh before deciding",
                409,
                "never",
                request.version,
              );
            if (request.data.status !== "pending")
              throw new DomainError("request_closed", "This request no longer accepts answers");
            if (request.data.manifestDigest !== req.body.manifestDigest)
              throw new DomainError(
                "stale_manifest",
                "The response does not bind the current request manifest",
              );
            if (new Date(request.data.deadline) <= (await tx.now()))
              throw new DomainError(
                "request_expired",
                "The deadline expired; an expired response never supplies approval",
              );
            let response: Json;
            try {
              response = validateValue(
                request.data.action.startsWith("approve") &&
                  req.body.response &&
                  typeof req.body.response === "object" &&
                  !Array.isArray(req.body.response) &&
                  typeof req.body.response.approved === "boolean"
                  ? {
                      ...req.body.response,
                      receiptId: request.id,
                      manifestDigest: request.data.manifestDigest,
                    }
                  : req.body.response,
                request.data.responseSchema as JsonSchema,
              );
            } catch {
              throw new DomainError(
                "invalid_response",
                "The response does not match the request's typed schema",
                400,
              );
            }
            const updated = await tx.put<HumanRequest>(
              "request",
              request.id,
              {
                ...request.data,
                status: "answered",
                response,
                responderId: req.actor.userId,
                reason: req.body.reason,
              },
              request.version,
            );
            await tx.emit("human.responded", updated, {
              requestId: request.id,
              requestVersion: request.version,
              runId: request.data.runId,
              occurrencePath: request.data.occurrencePath,
              manifestDigest: req.body.manifestDigest,
              response,
              actor: req.actor,
              receiptId: updated.id,
              responseDigest: digest(response),
              deadline: request.data.deadline,
            });
            return updated;
          },
        ),
    });
  }
}
