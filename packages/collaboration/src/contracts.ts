import { preservedJSON } from "@aa/catalog/definition";
import { envelope } from "@aa/platform/http";
import { z } from "zod";

const id = z.string().uuid();
export const draftSchema = z.strictObject({
  title: z.string(),
  kind: z.enum(["markdown", "playbook"]),
  epoch: id,
  sequence: z.int().nonnegative(),
  submittedHead: z.int().nonnegative(),
  stateBase64: z.string(),
  conflicts: z.array(id),
  pendingDependencies: z.boolean(),
});
export const graphSnapshotSchema = z.strictObject({
  root: z.string(),
  entities: z.array(
    z.strictObject({
      entityId: z.string(),
      deleted: z.boolean(),
      fields: preservedJSON,
      slots: z.record(z.string(), z.array(z.string())),
    }),
  ),
});
export const readDraftSchema = draftSchema.extend({
  content: preservedJSON,
  diagnostics: z.array(z.string()),
  graph: graphSnapshotSchema.optional(),
});
export const candidateSchema = z.strictObject({
  documentId: id,
  epoch: id,
  sequence: z.int().nonnegative(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  content: preservedJSON,
  validationProfile: z.string(),
});
export const revisionSchema = candidateSchema.extend({
  candidateId: id,
  submissionSequence: z.int().positive(),
});
export const draftOperationSchema = z.strictObject({
  documentId: id,
  epoch: id,
  sequence: z.int().positive(),
  actorId: z.string(),
  operationId: z.string(),
  updateBase64: z.string(),
  baseSequence: z.int().nonnegative(),
  writeSet: z.array(z.string()),
});
export const draftEnvelope = envelope(draftSchema);
export const readDraftEnvelope = envelope(readDraftSchema);
export const replacementSchema = z.strictObject({
  status: z.enum(["accepted", "conflict"]),
  draft: draftEnvelope,
  conflictId: id.optional(),
});
export const historySchema = z.strictObject({
  cursor: z.int().nonnegative(),
  items: z.array(envelope(draftOperationSchema)),
});
export const collaborationServerFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    protocol: z.literal("aa-collaboration/1"),
    type: z.literal("sync"),
    draft: readDraftEnvelope,
    updates: z.array(envelope(draftOperationSchema)),
    cursor: z.int().nonnegative(),
  }),
  z.strictObject({
    protocol: z.literal("aa-collaboration/1"),
    type: z.literal("receipt"),
    operationId: z.string(),
    receipt: z.union([draftEnvelope, replacementSchema]),
  }),
  z.strictObject({
    protocol: z.literal("aa-collaboration/1"),
    type: z.literal("presence"),
    actorId: z.string(),
    cursor: z.int().nonnegative(),
    expiresAt: z.int().positive(),
  }),
  z.strictObject({
    protocol: z.literal("aa-collaboration/1"),
    type: z.literal("presence_left"),
    actorId: z.string(),
  }),
  z.strictObject({
    protocol: z.literal("aa-collaboration/1"),
    type: z.literal("presence_expired"),
  }),
  z.strictObject({
    protocol: z.literal("aa-collaboration/1"),
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
