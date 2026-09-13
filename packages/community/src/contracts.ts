import { packageManifestSchema } from "@aa/catalog/package";
import { envelope } from "@aa/platform/http";
import { z } from "zod";
import { publicCandidateSchema } from "./service.ts";

const id = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const candidateEnvelope = envelope(
  publicCandidateSchema.extend({
    archiveBase64: z.string(),
    root: hash,
    closureDigest: hash,
    digest: hash,
    version: z.string(),
    inventory: packageManifestSchema,
  }),
);
const summary = z.strictObject({
  id,
  aggregateVersion: z.int().positive(),
  namespace: z.string(),
  name: z.string(),
  version: z.string(),
  status: z.enum(["active", "withdrawn", "quarantined"]),
  reasonCategory: z.string().nullable(),
  policyGeneration: z.int().nonnegative(),
});
const releaseShape = summary.extend({
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  authorName: z.string().optional(),
  organizationName: z.string().optional(),
  root: hash.optional(),
  closureDigest: hash.optional(),
  permissions: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  format: z.string().optional(),
  harness: z.array(z.string()).optional(),
  changelog: z.string().optional(),
  publishedAt: z.iso.datetime().optional(),
  rating: z
    .strictObject({ count: z.int().nonnegative(), average: z.number().min(1).max(5).nullable() })
    .optional(),
});
const visibility = (value: z.infer<typeof releaseShape>, ctx: z.RefinementCtx) => {
  const publicKeys = [
    "summary",
    "tags",
    "authorName",
    "organizationName",
    "root",
    "closureDigest",
    "permissions",
    "capabilities",
    "format",
    "harness",
    "changelog",
    "publishedAt",
    "rating",
  ] as const;
  for (const key of publicKeys)
    if ((value.status === "active") !== (value[key] !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "Public release visibility projection is inconsistent",
        path: [key],
      });
};
export const releaseSchema = releaseShape.superRefine(visibility);
const publicComment = z.strictObject({
  id,
  version: z.int().positive(),
  actorId: z.string(),
  parentId: id.nullable(),
  body: z.string().nullable(),
  edited: z.boolean(),
  status: z.string(),
  createdAt: z.iso.datetime(),
});
export const releaseReadSchema = releaseShape
  .extend({ comments: z.array(publicComment) })
  .superRefine(visibility);
export const ratingEnvelope = envelope(
  z.strictObject({
    actorId: z.string(),
    packageKey: z.string(),
    releaseId: id,
    reviewedVersion: z.string(),
    score: z.int().min(1).max(5),
  }),
);
export const commentEnvelope = envelope(
  z.strictObject({
    releaseId: id,
    actorId: z.string(),
    body: z.string().nullable(),
    parentId: id.nullable(),
    edited: z.boolean(),
    deleted: z.boolean(),
    hidden: z.boolean(),
  }),
);
export const bookmarkEnvelope = envelope(
  z.strictObject({ actorId: z.string(), releaseId: id, saved: z.boolean() }),
);
export const reportEnvelope = envelope(
  z.strictObject({
    targetType: z.string(),
    targetId: id,
    category: z.string(),
    explanation: z.string(),
    evidence: z.array(z.string()),
    reporterId: z.string(),
    status: z.string(),
  }),
);
export const decisionEnvelope = envelope(
  z.strictObject({
    targetId: id,
    action: z.enum([
      "quarantine",
      "restore",
      "withdraw",
      "hide_comment",
      "suspend_namespace",
      "restore_namespace",
    ]),
    actorId: z.string(),
    organizationId: id,
    reason: z.string(),
    category: z.string(),
    priorVersion: z.int().positive(),
    resultingVersion: z.int().positive(),
  }),
);
export const appealEnvelope = envelope(
  z.strictObject({
    decisionId: id,
    actorId: z.string(),
    explanation: z.string(),
    status: z.string(),
    outcome: z.enum(["upheld", "restoration_permitted"]).optional(),
    reason: z.string().optional(),
    reviewedBy: z.string().optional(),
    sameReviewerReason: z.string().nullable().optional(),
  }),
);
