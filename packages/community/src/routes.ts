import { importedPackageSchema } from "@aa/catalog/contracts";
import { draftEnvelope } from "@aa/collaboration/contracts";
import { type ApiRouter, envelope } from "@aa/platform/http";
import { z } from "zod";
import {
  appealEnvelope,
  bookmarkEnvelope,
  candidateEnvelope,
  commentEnvelope,
  decisionEnvelope,
  ratingEnvelope,
  releaseReadSchema,
  releaseSchema,
  reportEnvelope,
} from "./contracts.ts";
import { type CommunityService, publicCandidateSchema } from "./service.ts";
export function registerCommunity(router: ApiRouter, service: CommunityService) {
  router.add({
    method: "get",
    path: "/community/releases",
    summary: "Search explicitly public active packages",
    auth: "public",
    query: z.object({
      q: z.string().max(200).optional(),
      sort: z.enum(["recent", "rating", "relevance"]).default("recent"),
      tag: z.string().max(40).optional(),
      author: z.string().max(100).optional(),
      harness: z.string().max(100).optional(),
    }),
    response: z.object({ items: z.array(releaseSchema) }),
    handler: (req) => service.search(req.query),
  });
  router.add({
    method: "get",
    path: "/community/releases/:id",
    summary: "Read canonical public visibility and threaded comments",
    auth: "public",
    response: releaseReadSchema,
    handler: (req) => service.read(req.params.id),
  });
  router.add({
    method: "get",
    path: "/community/releases/:id/export",
    summary: "Download active public immutable package bytes",
    auth: "public",
    response: z.object({ archiveBase64: z.string() }),
    handler: async (req) => ({ archiveBase64: await service.archive(req.params.id) }),
  });
  router.add({
    method: "post",
    path: "/community/candidates",
    summary: "Prepare an exact private public-package preview for review",
    auth: "publisher",
    body: publicCandidateSchema,
    response: candidateEnvelope,
    handler: (req) => service.candidate(req.command("public_candidate"), req.actor, req.body),
  });
  router.add({
    method: "post",
    path: "/community/releases",
    summary: "Publish only the approved exact candidate with current scoped authority",
    auth: "publisher",
    body: z.strictObject({
      candidateId: z.string().uuid(),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      expectedPolicyVersion: z.number().int().min(0),
    }),
    response: releaseSchema,
    handler: (req) => service.publish(req.command("publish_release"), req.actor, req.body),
  });
  router.add({
    method: "post",
    path: "/community/releases/:id/import",
    summary: "Copy a public immutable closure into the current organization",
    body: z.strictObject({}),
    response: envelope(importedPackageSchema),
    handler: (req) =>
      service.import(req.command("community_import", { releaseId: req.params.id }), req.params.id),
  });
  router.add({
    method: "post",
    path: "/community/releases/:id/fork",
    summary: "Create a new local editable identity with retained source provenance and notices",
    body: z.strictObject({ title: z.string().min(1).max(160) }),
    response: draftEnvelope,
    handler: (req) =>
      service.fork(
        req.command("community_fork", { releaseId: req.params.id, ...req.body }),
        req.params.id,
        req.body.title,
      ),
  });
  router.add({
    method: "post",
    path: "/community/releases/:id/rating",
    summary: "Set one editable eligible rating for a reviewed package version",
    body: z.strictObject({
      score: z.number().int().min(1).max(5),
      reviewedVersion: z.string().min(1).max(80),
    }),
    response: ratingEnvelope,
    handler: (req) =>
      service.rating(
        req.command("set_rating", { releaseId: req.params.id, ...req.body }),
        req.params.id,
        req.body.score,
        req.body.reviewedVersion,
      ),
  });
  router.add({
    method: "post",
    path: "/community/releases/:id/comments",
    summary: "Add an attributed threaded public comment",
    body: z.strictObject({
      body: z.string().min(1).max(8000),
      parentId: z.string().uuid().optional(),
    }),
    response: commentEnvelope,
    handler: (req) =>
      service.comment(
        req.command("create_comment", { releaseId: req.params.id, ...req.body }),
        req.params.id,
        req.body.body,
        req.body.parentId,
      ),
  });
  router.add({
    method: "post",
    path: "/community/comments/:id",
    summary: "Edit or tombstone an author's comment while retaining moderation holds",
    body: z.strictObject({
      expectedVersion: z.number().int().positive(),
      body: z.string().min(1).max(8000).nullable(),
    }),
    response: commentEnvelope,
    handler: (req) =>
      service.editComment(
        req.command("edit_comment", { commentId: req.params.id, ...req.body }),
        req.params.id,
        req.body.expectedVersion,
        req.body.body,
      ),
  });
  router.add({
    method: "post",
    path: "/community/releases/:id/bookmark",
    summary: "Set a private per-person bookmark",
    body: z.strictObject({ saved: z.boolean() }),
    response: bookmarkEnvelope,
    handler: (req) =>
      service.bookmark(
        req.command("bookmark", { releaseId: req.params.id, ...req.body }),
        req.params.id,
        req.body.saved,
      ),
  });
  router.add({
    method: "get",
    path: "/community/bookmarks",
    summary: "Read only the signed-in person's private bookmarks",
    response: z.object({ items: z.array(bookmarkEnvelope) }),
    handler: (req) => service.bookmarks(req.actor.userId),
  });
  router.add({
    method: "post",
    path: "/community/reports",
    summary: "Submit private evidence to authorized moderation",
    body: z.strictObject({
      targetType: z.enum(["package", "release", "comment", "user"]),
      targetId: z.string().uuid(),
      category: z.string().min(1).max(80),
      explanation: z.string().min(1).max(8000),
      evidence: z.array(z.string().max(2000)).max(10),
    }),
    response: reportEnvelope,
    handler: (req) => service.report(req.command("report"), req.body),
  });
  router.add({
    method: "post",
    path: "/community/moderation",
    summary: "Record an attributed, reasoned, version-bound public policy decision",
    body: z.strictObject({
      targetId: z.string().uuid(),
      action: z.enum([
        "quarantine",
        "restore",
        "withdraw",
        "hide_comment",
        "suspend_namespace",
        "restore_namespace",
      ]),
      expectedVersion: z.number().int().positive(),
      reason: z.string().min(1).max(8000),
      category: z.string().min(1).max(80),
    }),
    response: decisionEnvelope,
    handler: (req) => service.moderate(req.command("moderation"), req.actor, req.body),
  });
  router.add({
    method: "post",
    path: "/community/appeals",
    summary: "Submit a private appeal tied to the exact moderation decision",
    body: z.strictObject({
      decisionId: z.string().uuid(),
      explanation: z.string().min(1).max(8000),
    }),
    response: appealEnvelope,
    handler: (req) =>
      service.appeal(req.command("appeal"), req.body.decisionId, req.body.explanation),
  });
  router.add({
    method: "get",
    path: "/community/moderation",
    summary: "Inspect private reports, appeals and audited decisions",
    auth: "moderator",
    response: z.object({
      reports: z.array(reportEnvelope),
      appeals: z.array(appealEnvelope),
      decisions: z.array(decisionEnvelope),
    }),
    handler: () => service.moderationQueue(),
  });
  router.add({
    method: "post",
    path: "/community/appeals/:id/decide",
    summary:
      "Record an independent appeal review; restoration still needs a current explicit policy decision",
    auth: "moderator",
    body: z.strictObject({
      expectedVersion: z.number().int().positive(),
      outcome: z.enum(["upheld", "restoration_permitted"]),
      reason: z.string().min(1).max(8000),
      sameReviewerReason: z.string().min(1).max(2000).optional(),
    }),
    response: appealEnvelope,
    handler: (req) =>
      service.decideAppeal(
        req.command("decide_appeal", { appealId: req.params.id, ...req.body }),
        req.actor,
        req.params.id,
        req.body,
      ),
  });
}
