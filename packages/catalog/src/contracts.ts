import { z } from "zod";
import { preservedJSON } from "./definition.ts";
import { packageManifestSchema } from "./package.ts";
import { runtimeProfileSchema } from "./service.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const catalogVersionSchema = z.strictObject({
  definition: preservedJSON,
  digest: hash,
  documentId: z.string().uuid().optional(),
  candidateId: z.string().uuid().optional(),
  importedRoot: hash.optional(),
});
export const runtimeProfileRevisionSchema = runtimeProfileSchema.extend({
  digest: hash,
  parentId: z.string().uuid().optional(),
});
export const importedPackageSchema = z.strictObject({
  manifest: packageManifestSchema,
  archiveBase64: z.string(),
  transportDigest: hash,
  attribution: z.record(
    hash,
    z.strictObject({ status: z.enum(["verified", "unverified"]), keyId: z.string().optional() }),
  ),
  importedBy: z.string(),
  advisoryCheckedAt: z.string().nullable(),
  executionGrant: z.null(),
});
