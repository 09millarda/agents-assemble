import { randomUUID } from "node:crypto";
import {
  type Candidate,
  type CollaborationService,
  type Draft,
  domainValidation,
} from "@aa/collaboration/service";
import { DomainError, type Message } from "@aa/platform/contracts";
import type { CommandMeta, ContextStore } from "@aa/platform/store";
import { z } from "zod";
import {
  canonical,
  type Definition,
  digest,
  normalizeDefinition,
  runtimeCapabilitySchema,
} from "./definition.ts";
import {
  type ExportRights,
  exportPackage,
  type PackageManifest,
  packageDefinition,
  type TrustKey,
  verifyPackage,
} from "./package.ts";

export function identityId(value: unknown): string {
  const hash = digest(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export const runtimeProfileSchema = z.strictObject({
  name: z.string().min(1).max(160),
  harness: z.literal("codex"),
  model: z.string().min(1).max(160),
  effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]),
  sandbox: z.enum(["read-only", "workspace-write"]),
  trustedRunner: z.boolean(),
  codexVersion: z.literal("0.153.4"),
  capabilities: z.array(runtimeCapabilitySchema).max(4),
});
export type RuntimeProfile = z.infer<typeof runtimeProfileSchema> & {
  digest: string;
  parentId?: string;
};
export interface CatalogVersion {
  definition: Definition;
  digest: string;
  documentId?: string;
  candidateId?: string;
  importedRoot?: string;
}
export interface ImportedPackage {
  manifest: PackageManifest;
  archiveBase64: string;
  transportDigest: string;
  attribution: Record<string, { status: "verified" | "unverified"; keyId?: string }>;
  importedBy: string;
  advisoryCheckedAt: string | null;
  executionGrant: null;
}
export class CatalogService {
  constructor(
    public readonly store: ContextStore,
    public readonly collaboration: CollaborationService,
    public readonly installationId = "local",
    public readonly trust: TrustKey[] = [],
  ) {}
  communityCheckpoint(organizationId: string): Promise<string | undefined> {
    return this.store.read(
      organizationId,
      async (tx) =>
        (
          await tx.get<{ messageId: string }>(
            "community-catchup",
            identityId({ communityCatchup: true }),
          )
        )?.data.messageId,
    );
  }
  advanceCommunityCheckpoint(organizationId: string, messageId: string) {
    return this.store.command(
      {
        organizationId,
        actorId: "worker",
        operation: "community-catchup",
        operationId: messageId,
        request: { messageId },
      },
      async (tx) => {
        const id = identityId({ communityCatchup: true }),
          prior = await tx.get<{ messageId: string }>("community-catchup", id);
        return tx.put("community-catchup", id, { messageId }, prior?.version ?? 0);
      },
    );
  }
  create(meta: CommandMeta, title: string, definition: unknown) {
    return this.collaboration.create(
      meta,
      title,
      "playbook",
      domainValidation(() => normalizeDefinition(definition)),
    );
  }
  list(organizationId: string) {
    return this.collaboration.list(organizationId);
  }
  versions(organizationId: string) {
    return this.store.read(organizationId, (tx) => tx.all<CatalogVersion>("version"));
  }
  getVersion(organizationId: string, id: string) {
    return this.store.read(organizationId, (tx) => tx.require<CatalogVersion>("version", id));
  }
  async resolveVersion(organizationId: string, id: string) {
    return this.store.read(organizationId, async (tx) => {
      const version = await tx.require<CatalogVersion>("version", id);
      const componentDigests = new Set<string>();
      if (version.data.importedRoot) {
        const imported = (await tx.all<ImportedPackage>("import")).find((item) =>
          item.data.manifest.components.some(
            (component) => component.digest === version.data.importedRoot,
          ),
        );
        if (!imported)
          throw new DomainError(
            "closure_unavailable",
            "Imported version has no complete local closure",
            409,
          );
        const visit = (key: string) => {
          if (componentDigests.has(key)) return;
          componentDigests.add(key);
          const component = imported.data.manifest.components.find((item) => item.digest === key);
          if (!component)
            throw new DomainError("closure_unavailable", "A pinned component is unavailable", 409);
          component.descriptor.dependencies.forEach(visit);
        };
        visit(version.data.importedRoot);
      }
      if (version.data.documentId) {
        const fork = await tx.get<{ manifest: PackageManifest }>(
          "fork_source",
          version.data.documentId,
        );
        if (fork)
          fork.data.manifest.components.forEach((component) => {
            componentDigests.add(component.digest);
          });
      }
      return {
        id: version.id,
        digest: version.data.digest,
        definition: version.data.definition,
        componentDigests: [...componentDigests].sort(),
      };
    });
  }
  eligibility(organizationId: string) {
    return this.store.read(organizationId, (tx) =>
      tx.all<{
        advisoryId: string;
        components: string[];
        policyGeneration: number;
        state: "quarantined" | "review_required";
        sourceMessageId: string;
      }>("package_advisory"),
    );
  }
  acceptCommunityPolicy(organizationId: string, message: Message) {
    if (message.source !== "community")
      throw new DomainError(
        "untrusted_advisory",
        "Advisories require the configured Community authority",
        403,
      );
    return this.store.consume({ ...message, organizationId }, async (tx) => {
      if (message.type !== "community.release_policy_changed") return { status: "observed" };
      const body = z
        .object({
          releaseId: z.string().uuid(),
          root: z.string(),
          components: z.array(z.string()),
          policyGeneration: z.number().int().positive(),
          status: z.enum(["active", "withdrawn", "quarantined"]),
          decisionId: z.string().uuid(),
        })
        .parse(message.payload);
      const matched = body.components;
      const id = identityId({ advisory: body.releaseId });
      const previous = await tx.get<{
        advisoryId: string;
        components: string[];
        policyGeneration: number;
        state: string;
      }>("package_advisory", id);
      if (!matched.length || body.status === "withdrawn" || (body.status === "active" && !previous))
        return { status: "not_applicable" };
      if (previous && body.policyGeneration <= previous.data.policyGeneration)
        throw new DomainError(
          "stale_advisory",
          "Older policy cannot overwrite an accepted advisory",
          409,
        );
      const advisory = await tx.put(
        "package_advisory",
        id,
        {
          advisoryId: body.releaseId,
          components: matched,
          policyGeneration: body.policyGeneration,
          state: body.status === "quarantined" ? "quarantined" : "review_required",
          sourceMessageId: message.id,
          sourceDecisionId: body.decisionId,
          propagation: "pending_execution",
        },
        previous?.version ?? 0,
      );
      await tx.emit("catalog.package_policy_changed", advisory, {
        advisoryId: body.releaseId,
        components: matched,
        policyGeneration: body.policyGeneration,
        hold: true,
        state: advisory.data.state,
      });
      return { status: "pending_execution", advisoryId: body.releaseId };
    });
  }
  acceptExecutionPolicy(message: Message) {
    if (message.source !== "execution")
      throw new DomainError(
        "untrusted_policy_receipt",
        "Only Execution can report its applied policy cutoff",
        403,
      );
    return this.store.consume(message, async (tx) => {
      if (message.type !== "execution.package_policy_applied") return { status: "observed" };
      const body = z
        .object({ advisoryId: z.string().uuid(), policyGeneration: z.number().int().positive() })
        .parse(message.payload);
      const id = identityId({ advisory: body.advisoryId });
      const advisory = await tx.get<{ policyGeneration: number; propagation: string }>(
        "package_advisory",
        id,
      );
      if (!advisory || advisory.data.policyGeneration !== body.policyGeneration)
        return { status: "historical_receipt" };
      await tx.put(
        "package_advisory",
        id,
        { ...advisory.data, propagation: "effective", executionReceiptId: message.id },
        advisory.version,
      );
      return {
        status: "effective",
        advisoryId: body.advisoryId,
        policyGeneration: body.policyGeneration,
      };
    });
  }
  publish(meta: CommandMeta, documentId: string, candidateId: string, expectedHead: number) {
    return this.store.command(meta, async (tx) => {
      const draft = await tx.require<Draft>("draft", documentId);
      const candidate = await tx.require<Candidate>("candidate", candidateId);
      if (candidate.data.documentId !== documentId)
        throw new DomainError("not_found", "Candidate unavailable", 404);
      if (draft.data.submittedHead !== expectedHead)
        throw new DomainError(
          "head_conflict",
          "The submitted head changed after review",
          409,
          "never",
          draft.data.submittedHead,
        );
      const definition = domainValidation(() => normalizeDefinition(candidate.data.content));
      const versionId = identityId({ package: definition.package });
      const prior = await tx.get<CatalogVersion>("version", versionId);
      if (prior && prior.data.digest !== candidate.data.digest)
        throw new DomainError(
          "immutable_version_conflict",
          "A different definition already owns this package version",
          409,
        );
      if (prior) return prior;
      const version = await tx.put<CatalogVersion>("version", versionId, {
        definition,
        digest: candidate.data.digest,
        documentId,
        candidateId,
      });
      const saved = await tx.put(
        "draft",
        documentId,
        { ...draft.data, submittedHead: expectedHead + 1 },
        draft.version,
      );
      await tx.emit("catalog.version_published", saved, {
        versionId: version.id,
        digest: version.data.digest,
        package: definition.package,
        candidateId,
      });
      return version;
    });
  }
  profiles(organizationId: string) {
    return this.store.read(organizationId, (tx) => tx.all<RuntimeProfile>("runtime_profile"));
  }
  getRuntimeProfile(organizationId: string, id: string) {
    return this.store.read(organizationId, (tx) =>
      tx.require<RuntimeProfile>("runtime_profile", id),
    );
  }
  createRuntimeProfile(
    meta: CommandMeta,
    body: z.infer<typeof runtimeProfileSchema>,
    parentId?: string,
  ) {
    return this.store.command(meta, async (tx) => {
      const value = runtimeProfileSchema.parse(body);
      if (parentId) await tx.require("runtime_profile", parentId);
      const profile = await tx.put<RuntimeProfile>("runtime_profile", randomUUID(), {
        ...value,
        digest: digest(value),
        ...(parentId ? { parentId } : {}),
      });
      await tx.emit("catalog.runtime_profile_created", profile, {
        profileId: profile.id,
        digest: profile.data.digest,
      });
      return profile;
    });
  }
  importPackage(meta: CommandMeta, archiveBase64: string) {
    return this.store.command(meta, async (tx) => {
      if (archiveBase64.length > 5592408)
        throw new DomainError("package_limit", "Encoded package exceeds 4 MiB transport", 413);
      const bytes = Buffer.from(archiveBase64, "base64");
      if (bytes.toString("base64") !== archiveBase64)
        throw new DomainError("invalid_package", "Expected canonical padded base64", 400);
      const verified = domainValidation(() => verifyPackage(bytes, this.trust));
      for (const component of verified.manifest.components) {
        const id = identityId({
          origin: component.descriptor.origin,
          version: component.descriptor.version,
        });
        const existing = await tx.get<{ digest: string; descriptor: unknown }>("component", id);
        if (existing && existing.data.digest !== component.digest)
          throw new DomainError(
            "origin_conflict",
            "An immutable component origin/version already binds different bytes",
            409,
          );
        if (!existing) await tx.put("component", id, component);
      }
      // Blob availability, identities, imported root and proof evidence commit together in Catalog.
      for (const [hash, blob] of verified.blobs) {
        const id = identityId({ blob: hash });
        if (!(await tx.get("package_blob", id)))
          await tx.put("package_blob", id, { digest: hash, base64: blob.toString("base64") });
      }
      const id = identityId({ root: verified.manifest.root });
      const existing = await tx.get<ImportedPackage>("import", id);
      const proofs = [
        ...(existing?.data.manifest.proofs ?? []),
        ...verified.manifest.proofs,
      ].filter(
        (proof, index, items) =>
          items.findIndex((item) => canonical(item) === canonical(proof)) === index,
      );
      // Evidence is accumulated independently; unsigned replay cannot erase a previous proof.
      for (const proof of proofs) {
        const proofId = identityId({ proof });
        if (!(await tx.get("publisher_evidence", proofId)))
          await tx.put("publisher_evidence", proofId, proof);
      }
      const evidence = (await tx.all<PackageManifest["proofs"][number]>("publisher_evidence"))
        .map((item) => item.data)
        .filter((proof) =>
          verified.manifest.components.some((component) => component.digest === proof.component),
        );
      const mergedAttribution = domainValidation(
        () =>
          verifyPackage(
            exportPackage({ ...verified.manifest, proofs: evidence }, verified.blobs, this.trust),
            this.trust,
          ).attribution,
      );
      const imported = await tx.put<ImportedPackage>(
        "import",
        id,
        {
          manifest: verified.manifest,
          archiveBase64,
          transportDigest: verified.transportDigest,
          attribution: mergedAttribution,
          importedBy: existing?.data.importedBy ?? meta.actorId,
          advisoryCheckedAt: existing?.data.advisoryCheckedAt ?? null,
          executionGrant: null,
        },
        existing?.version ?? 0,
      );
      for (const [root, definition] of Object.entries(verified.definitions)) {
        const versionId = identityId({ imported: root });
        if (!(await tx.get("version", versionId)))
          await tx.put<CatalogVersion>("version", versionId, {
            definition,
            digest: digest(definition),
            importedRoot: root,
          });
      }
      await tx.emit("catalog.package_imported", imported, {
        root: verified.manifest.root,
        closureDigest: verified.manifest.closureDigest,
      });
      return imported;
    });
  }
  async exportImported(organizationId: string, id: string): Promise<Buffer> {
    return this.store.read(organizationId, async (tx) => {
      const imported = await tx.require<ImportedPackage>("import", id);
      const blobs = new Map<string, Buffer>();
      for (const component of imported.data.manifest.components)
        for (const file of component.descriptor.files) {
          const blob = await tx.require<{ base64: string }>(
            "package_blob",
            identityId({ blob: file.digest }),
          );
          blobs.set(file.digest, Buffer.from(blob.data.base64, "base64"));
        }
      const evidence = (await tx.all<PackageManifest["proofs"][number]>("publisher_evidence"))
        .map((record) => record.data)
        .filter((proof) =>
          imported.data.manifest.components.some(
            (component) => component.digest === proof.component,
          ),
        );
      return domainValidation(() =>
        exportPackage({ ...imported.data.manifest, proofs: evidence }, blobs, this.trust),
      );
    });
  }
  async getImport(organizationId: string, id: string) {
    const imported = await this.store.read(organizationId, (tx) =>
      tx.require<ImportedPackage>("import", id),
    );
    const bytes = await this.exportImported(organizationId, id);
    const verified = domainValidation(() => verifyPackage(bytes, this.trust));
    return { ...imported, data: { ...imported.data, attribution: verified.attribution } };
  }
  async forkPackage(meta: CommandMeta, importId: string, title: string, publicSource = false) {
    const imported = await this.store.read(meta.organizationId, (tx) =>
      tx.require<ImportedPackage>("import", importId),
    );
    const verified = domainValidation(() =>
      verifyPackage(Buffer.from(imported.data.archiveBase64, "base64"), this.trust),
    );
    const original = verified.definitions[verified.manifest.root];
    if (!original)
      throw new DomainError(
        "unsupported_fork",
        "The selected root is not a supported playbook",
        400,
      );
    const definition = normalizeDefinition({
      ...original,
      package: {
        id: `fork/${identityId({ operation: meta.operationId, actor: meta.actorId })}`,
        version: "0.1.0",
      },
    });
    const draft = await this.collaboration.create(
      { ...meta, operation: "fork_draft" },
      title,
      "playbook",
      definition,
    );
    return this.store.command({ ...meta, operation: "fork_package" }, async (tx) => {
      const source = verified.manifest.components.find(
        (item) => item.digest === verified.manifest.root,
      );
      if (!source) throw new DomainError("closure_unavailable", "Fork source unavailable", 409);
      await tx.put("fork_source", draft.id, {
        documentId: draft.id,
        origin: source.descriptor.origin,
        version: source.descriptor.version,
        digest: source.digest,
        terms: source.descriptor.terms,
        manifest: verified.manifest,
        publicSource,
      });
      return draft;
    });
  }
  exportVersion(meta: CommandMeta, id: string, rights?: ExportRights) {
    return this.store.command(meta, async (tx) => {
      const version = await tx.require<CatalogVersion>("version", id);
      const originId = identityId({ exportOrigin: version.data.definition.package.id });
      let mapping = await tx.get<{
        origin: { installation: string; organization: string; package: string };
      }>("export_origin", originId);
      if (!mapping)
        mapping = await tx.put("export_origin", originId, {
          origin: {
            installation: this.installationId,
            organization: randomUUID(),
            package: randomUUID(),
          },
        });
      const source = version.data.documentId
        ? await tx.get<{
            publicSource: boolean;
            origin: { installation: string; organization: string; package: string };
            version: string;
            digest: string;
          }>("fork_source", version.data.documentId)
        : undefined;
      if (source && !source.data.publicSource)
        throw new DomainError(
          "public_ancestry_review_required",
          "Select an exact approved public ancestry tuple or explicit redaction before export",
          409,
        );
      const ancestry = source
        ? [{ origin: source.data.origin, version: source.data.version, digest: source.data.digest }]
        : [];
      const bytes = domainValidation(() =>
        packageDefinition(version.data.definition, mapping.data.origin, rights, ancestry),
      );
      const verified = domainValidation(() => verifyPackage(bytes, this.trust));
      for (const component of verified.manifest.components) {
        const identity = identityId({
          origin: component.descriptor.origin,
          version: component.descriptor.version,
        });
        const previous = await tx.get<{ digest: string }>("exported_component", identity);
        if (previous && previous.data.digest !== component.digest)
          throw new DomainError(
            "immutable_version_conflict",
            "Changed export bytes or terms require a new component version",
            409,
          );
        if (!previous) await tx.put("exported_component", identity, { digest: component.digest });
      }
      return {
        archiveBase64: bytes.toString("base64"),
        ...domainValidation(() => {
          const verified = verifyPackage(bytes, this.trust);
          return { root: verified.manifest.root, closureDigest: verified.manifest.closureDigest };
        }),
      };
    });
  }
}
