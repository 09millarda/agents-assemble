import { draftEnvelope } from "@aa/collaboration/contracts";
import { domainValidation } from "@aa/collaboration/service";
import { type ApiRouter, envelope } from "@aa/platform/http";
import { z } from "zod";
import {
  catalogVersionSchema,
  importedPackageSchema,
  runtimeProfileRevisionSchema,
} from "./contracts.ts";
import { digest, normalizeDefinition, preservedJSON, toTypeScript } from "./definition.ts";
import { exportRightsSchema } from "./package.ts";
import { type CatalogService, runtimeProfileSchema } from "./service.ts";
import { starterPlaybook } from "./starters.ts";

const version = envelope(catalogVersionSchema),
  profile = envelope(runtimeProfileRevisionSchema);
const result = draftEnvelope;
export function registerCatalog(router: ApiRouter, service: CatalogService) {
  router.add({
    method: "get",
    path: "/catalog/starters",
    summary: "Read complete first-party starter playbook definitions",
    response: z.object({
      items: z.array(z.object({ name: z.string(), definition: preservedJSON })),
    }),
    handler: () => ({
      items: (["new-feature", "bug-fix"] as const).map((name) => ({
        name,
        definition: starterPlaybook(name),
      })),
    }),
  });
  router.add({
    method: "post",
    path: "/catalog/validate",
    summary: "Validate supported canonical playbook behavior, pins and bounds",
    body: z.strictObject({ definition: preservedJSON }),
    response: z.object({ valid: z.literal(true), digest: z.string(), definition: preservedJSON }),
    handler: (req) =>
      domainValidation(() => {
        const definition = normalizeDefinition(req.body.definition);
        return { valid: true as const, digest: digest(definition), definition };
      }),
  });
  router.add({
    method: "post",
    path: "/catalog/typescript",
    summary: "Generate lossless local TypeScript builder source",
    body: z.strictObject({ definition: preservedJSON }),
    response: z.object({ source: z.string() }),
    handler: (req) => domainValidation(() => ({ source: toTypeScript(req.body.definition) })),
  });
  router.add({
    method: "get",
    path: "/catalog/playbooks",
    summary: "List private organization playbook drafts",
    response: z.object({ items: z.array(result) }),
    handler: async (req) => ({ items: await service.list(req.actor.organizationId) }),
  });
  router.add({
    method: "post",
    path: "/catalog/playbooks",
    summary: "Create a validated collaborative playbook draft",
    body: z.strictObject({ title: z.string().min(1).max(160), definition: preservedJSON }),
    response: result,
    handler: (req) =>
      service.create(req.command("create_playbook"), req.body.title, req.body.definition),
  });
  router.add({
    method: "post",
    path: "/catalog/playbooks/:id/publish",
    summary: "Publish an exact reviewed immutable organization version",
    body: z.strictObject({ candidateId: z.string().uuid(), expectedHead: z.number().int().min(0) }),
    response: version,
    handler: (req) =>
      service.publish(
        req.command("publish_version", { id: req.params.id, ...req.body }),
        req.params.id,
        req.body.candidateId,
        req.body.expectedHead,
      ),
  });
  router.add({
    method: "get",
    path: "/catalog/versions",
    summary: "List immutable local and imported playbook versions",
    response: z.object({ items: z.array(version) }),
    handler: async (req) => ({ items: await service.versions(req.actor.organizationId) }),
  });
  router.add({
    method: "get",
    path: "/catalog/versions/:id",
    summary: "Read an exact executable version and digest",
    response: version,
    handler: (req) => service.getVersion(req.actor.organizationId, req.params.id),
  });
  router.add({
    method: "get",
    path: "/runtime-profiles",
    summary: "List immutable Codex runtime profile revisions",
    response: z.object({ items: z.array(profile) }),
    handler: async (req) => ({ items: await service.profiles(req.actor.organizationId) }),
  });
  router.add({
    method: "post",
    path: "/runtime-profiles",
    summary: "Create an exact requested Codex runtime profile",
    auth: "admin",
    body: runtimeProfileSchema,
    response: profile,
    handler: (req) => service.createRuntimeProfile(req.command("create_runtime_profile"), req.body),
  });
  router.add({
    method: "post",
    path: "/runtime-profiles/:id/revisions",
    summary: "Create an immutable successor runtime profile revision",
    auth: "admin",
    body: runtimeProfileSchema,
    response: profile,
    handler: (req) =>
      service.createRuntimeProfile(
        req.command("revise_runtime_profile", { parentId: req.params.id, ...req.body }),
        req.body,
        req.params.id,
      ),
  });
  router.add({
    method: "post",
    path: "/catalog/packages/import",
    summary: "Verify and atomically import a complete offline package; grants no execution",
    body: z.strictObject({ archiveBase64: z.string().max(5592408) }),
    response: envelope(importedPackageSchema),
    handler: (req) => service.importPackage(req.command("import_package"), req.body.archiveBase64),
  });
  router.add({
    method: "get",
    path: "/catalog/packages/:id",
    summary: "Read imported bytes with attribution re-evaluated against current trust",
    response: envelope(importedPackageSchema),
    handler: (req) => service.getImport(req.actor.organizationId, req.params.id),
  });
  router.add({
    method: "get",
    path: "/catalog/packages/:id/export",
    summary: "Export a complete local closure and selected publisher proofs offline",
    response: z.object({ archiveBase64: z.string() }),
    handler: async (req) => ({
      archiveBase64: (
        await service.exportImported(req.actor.organizationId, req.params.id)
      ).toString("base64"),
    }),
  });
  router.add({
    method: "post",
    path: "/catalog/versions/:id/export",
    summary: "Export explicit permitted components under a stable opaque origin",
    body: z.strictObject({ rights: exportRightsSchema.optional() }),
    response: z.object({ archiveBase64: z.string(), root: z.string(), closureDigest: z.string() }),
    handler: (req) =>
      service.exportVersion(
        req.command("export_version", { id: req.params.id, ...req.body }),
        req.params.id,
        req.body.rights,
      ),
  });
}
