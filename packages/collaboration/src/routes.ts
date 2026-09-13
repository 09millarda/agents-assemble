import { preservedJSON } from "@aa/catalog/definition";
import { DomainError } from "@aa/platform/contracts";
import { type ApiRouter, envelope } from "@aa/platform/http";
import { z } from "zod";
import {
  candidateSchema,
  draftEnvelope,
  historySchema,
  readDraftEnvelope,
  replacementSchema,
  revisionSchema,
} from "./contracts.ts";
import { graphCommandSchema } from "./graph.ts";
import type { CollaborationService } from "./service.ts";

const result = draftEnvelope;
export function registerCollaboration(
  router: ApiRouter,
  owners: { catalog: CollaborationService; knowledge: CollaborationService },
) {
  const service = (owner: string) => {
    if (owner !== "catalog" && owner !== "knowledge")
      throw new DomainError("not_found", "Unknown collaboration owner", 404);
    return owners[owner];
  };
  router.add({
    method: "get",
    path: "/knowledge/documents",
    summary: "List authorized Markdown documents",
    response: z.object({ items: z.array(result) }),
    handler: async (req) => ({ items: await owners.knowledge.list(req.actor.organizationId) }),
  });
  router.add({
    method: "post",
    path: "/knowledge/documents",
    summary: "Create a collaborative Markdown document",
    body: z.strictObject({ title: z.string().min(1).max(160), content: z.string().max(524288) }),
    response: result,
    handler: (req) =>
      owners.knowledge.create(
        req.command("create_document"),
        req.body.title,
        "markdown",
        req.body.content,
      ),
  });
  router.add({
    method: "get",
    path: "/collaboration/:owner/:id",
    summary: "Read owner-durable draft state and materialized content",
    response: readDraftEnvelope,
    handler: (req) => service(req.params.owner).read(req.actor.organizationId, req.params.id),
  });
  router.add({
    method: "get",
    path: "/collaboration/:owner/:id/updates",
    summary: "Recover attributed acknowledged updates after a cursor",
    query: z.object({ cursor: z.coerce.number().int().min(0).default(0) }),
    response: historySchema,
    handler: (req) =>
      service(req.params.owner).history(req.actor.organizationId, req.params.id, req.query.cursor),
  });
  router.add({
    method: "post",
    path: "/collaboration/:owner/:id/updates",
    summary: "Accept a Yjs Markdown update before acknowledgment",
    body: z.strictObject({ epoch: z.string().uuid(), updateBase64: z.string().max(700000) }),
    response: result,
    handler: (req) =>
      service(req.params.owner).update(
        req.command("draft_update", { id: req.params.id, ...req.body }),
        req.params.id,
        req.body,
      ),
  });
  router.add({
    method: "post",
    path: "/collaboration/:owner/:id/replace",
    summary: "Submit an exact-base content replacement proposal",
    body: z.strictObject({
      epoch: z.string().uuid(),
      expectedSequence: z.number().int().min(0),
      content: preservedJSON,
    }),
    response: replacementSchema,
    handler: (req) =>
      service(req.params.owner).replace(
        req.command("draft_replace", { id: req.params.id, ...req.body }),
        req.params.id,
        req.body,
      ),
  });
  router.add({
    method: "post",
    path: "/collaboration/:owner/:id/graph",
    summary: "Apply an owner-validated graph command with semantic conflict detection",
    body: z.strictObject({
      epoch: z.string().uuid(),
      baseSequence: z.number().int().min(0),
      command: graphCommandSchema,
    }),
    response: replacementSchema,
    handler: (req) =>
      service(req.params.owner).graph(
        req.command("graph_command", { id: req.params.id, ...req.body }),
        req.params.id,
        req.body,
      ),
  });
  router.add({
    method: "post",
    path: "/collaboration/:owner/:id/conflicts/:conflictId/resolve",
    summary: "Resolve only the exact observed semantic conflict",
    body: z.strictObject({ expectedSequence: z.number().int().min(0) }),
    response: result,
    handler: (req) =>
      service(req.params.owner).resolveConflict(
        req.command("resolve_conflict", { ...req.params, ...req.body }),
        req.params.id,
        req.params.conflictId,
        req.body.expectedSequence,
      ),
  });
  router.add({
    method: "post",
    path: "/collaboration/:owner/:id/candidates",
    summary: "Freeze exact owner bytes into an immutable review candidate",
    body: z.strictObject({ epoch: z.string().uuid(), expectedSequence: z.number().int().min(0) }),
    response: envelope(candidateSchema),
    handler: (req) =>
      service(req.params.owner).candidate(
        req.command("draft_candidate", { id: req.params.id, ...req.body }),
        req.params.id,
        req.body,
      ),
  });
  router.add({
    method: "post",
    path: "/collaboration/:owner/:id/submit",
    summary: "Submit a reviewed candidate against the expected submitted head",
    body: z.strictObject({ candidateId: z.string().uuid(), expectedHead: z.number().int().min(0) }),
    response: envelope(revisionSchema),
    handler: (req) =>
      service(req.params.owner).submit(
        req.command("draft_submit", { id: req.params.id, ...req.body }),
        req.params.id,
        req.body,
      ),
  });
  router.add({
    method: "get",
    path: "/knowledge/revisions/:id",
    summary: "Read exact immutable Markdown revision bytes",
    response: envelope(revisionSchema),
    handler: (req) => owners.knowledge.getRevision(req.actor.organizationId, req.params.id),
  });
}
