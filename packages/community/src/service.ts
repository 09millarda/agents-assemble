import { randomUUID } from "node:crypto";
import { digest } from "@aa/catalog/definition";
import { exportRightsSchema, verifyPackage } from "@aa/catalog/package";
import { type CatalogService, identityId } from "@aa/catalog/service";
import { domainValidation } from "@aa/collaboration/service";
import { type Actor, DomainError } from "@aa/platform/contracts";
import type { CommandMeta, ContextStore, RecordEnvelope } from "@aa/platform/store";
import { z } from "zod";
import osi from "./osi-licenses.json";

export const PUBLIC_ORGANIZATION = "00000000-0000-4000-a000-000000000002";
export interface CommunityAuthority {
  recheck(actor: Actor, role: "publisher" | "moderator" | "member"): Promise<unknown>;
  isMember(userId: string, organizationId: string): Promise<boolean>;
  invited?(actor: Actor): Promise<boolean>;
}
export const publicCandidateSchema = z.strictObject({
  versionId: z.string().uuid(),
  namespace: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  name: z.string().min(1).max(160),
  summary: z.string().max(2000),
  tags: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(20),
  authorName: z.string().min(1).max(100),
  organizationName: z.string().min(1).max(100),
  rights: exportRightsSchema.optional(),
});
type CandidateInput = z.infer<typeof publicCandidateSchema>;
interface PublicCandidate extends CandidateInput {
  archiveBase64: string;
  root: string;
  closureDigest: string;
  digest: string;
  version: string;
  inventory: import("@aa/catalog/package").PackageManifest;
}
export interface Release {
  namespace: string;
  name: string;
  summary: string;
  tags: string[];
  authorName: string;
  organizationName: string;
  version: string;
  root: string;
  closureDigest: string;
  permissions: string[];
  capabilities: string[];
  format: string;
  harness: string[];
  changelog: string;
  publishedAt: string;
  status: "active" | "withdrawn" | "quarantined";
  policyGeneration: number;
  reasonCategory: string | null;
}
interface Publication {
  organizationId: string;
  actorId: string;
  candidateId: string;
  archiveBase64: string;
  authorityGeneration: number;
}
interface Rating {
  actorId: string;
  packageKey: string;
  releaseId: string;
  reviewedVersion: string;
  score: number;
}
interface Comment {
  releaseId: string;
  actorId: string;
  body: string | null;
  parentId: string | null;
  edited: boolean;
  deleted: boolean;
  hidden: boolean;
}
interface Decision {
  targetId: string;
  action:
    | "quarantine"
    | "restore"
    | "withdraw"
    | "hide_comment"
    | "suspend_namespace"
    | "restore_namespace";
  actorId: string;
  organizationId: string;
  reason: string;
  category: string;
  priorVersion: number;
  resultingVersion: number;
}
const publicMeta = (meta: CommandMeta): CommandMeta => ({
  ...meta,
  organizationId: PUBLIC_ORGANIZATION,
  request: { organizationId: meta.organizationId, request: meta.request },
});
export class CommunityService {
  constructor(
    public readonly store: ContextStore,
    public readonly catalog: CatalogService,
    public readonly authority: CommunityAuthority,
    public readonly hosted = false,
  ) {}
  async candidate(meta: CommandMeta, actor: Actor, body: CandidateInput) {
    await this.authority.recheck(actor, "publisher");
    const exported = await this.catalog.exportVersion(
      {
        ...meta,
        operation: "public_export",
        request: { versionId: body.versionId, rights: body.rights ?? null },
      },
      body.versionId,
      body.rights,
    );
    return this.catalog.store.command({ ...meta, operation: "public_candidate" }, async (tx) => {
      const verified = domainValidation(() =>
        verifyPackage(Buffer.from(exported.archiveBase64, "base64"), this.catalog.trust),
      );
      for (const component of verified.manifest.components)
        if (
          ["playbook", "action", "schema"].includes(component.descriptor.kind) &&
          !osi.licenseIds.includes(component.descriptor.terms.license)
        )
          throw new DomainError(
            "public_license_required",
            "Every public software component needs an OSI-approved SPDX license and redistribution permission",
            409,
          );
      const root = verified.manifest.components.find(
        (component) => component.digest === verified.manifest.root,
      );
      if (!root) throw new DomainError("closure_unavailable", "Package root unavailable", 409);
      const value = {
        ...body,
        ...exported,
        version: root.descriptor.version,
        inventory: verified.manifest,
      };
      return tx.put<PublicCandidate>("public_candidate", randomUUID(), {
        ...value,
        digest: digest(value),
      });
    });
  }
  async publish(
    meta: CommandMeta,
    actor: Actor,
    body: { candidateId: string; digest: string; expectedPolicyVersion: number },
  ) {
    const candidate = await this.catalog.store.read(meta.organizationId, (tx) =>
      tx.require<PublicCandidate>("public_candidate", body.candidateId),
    );
    if (candidate.data.digest !== body.digest)
      throw new DomainError(
        "candidate_mismatch",
        "Approval must bind the exact reviewed public candidate",
        409,
      );
    return this.store.command(publicMeta(meta), async (tx) => {
      const namespaceId = identityId({ namespace: candidate.data.namespace });
      let namespace = await tx.get<{
        organizationId: string;
        policyVersion: number;
        suspended: boolean;
      }>("namespace", namespaceId);
      if (
        (namespace?.data.policyVersion ?? 0) !== body.expectedPolicyVersion ||
        namespace?.data.suspended ||
        (namespace && namespace.data.organizationId !== meta.organizationId)
      )
        throw new DomainError(
          "namespace_policy_conflict",
          "Namespace ownership or policy changed before publication",
          409,
        );
      // Stage immutable, bounded, verified bytes before the visibility acceptance check.
      const verified = domainValidation(() =>
        verifyPackage(Buffer.from(candidate.data.archiveBase64, "base64"), this.catalog.trust),
      );
      const releaseId = identityId({
        namespace: candidate.data.namespace,
        package: candidate.data.name,
        version: candidate.data.version,
      });
      const existing = await tx.get<Release>("release", releaseId);
      if (existing) {
        if (existing.data.root !== candidate.data.root)
          throw new DomainError(
            "immutable_version_conflict",
            "A public version already binds different bytes",
            409,
          );
        return this.publicRelease(existing, tx);
      }
      await this.authority.recheck(actor, "publisher");
      if (this.hosted && (!this.authority.invited || !(await this.authority.invited(actor))))
        throw new DomainError(
          "publication_invitation_required",
          "Hosted publication requires a current pilot invitation",
          403,
        );
      if (!namespace)
        namespace = await tx.put("namespace", namespaceId, {
          organizationId: meta.organizationId,
          policyVersion: 0,
          suspended: false,
        });
      const definition = verified.definitions[verified.manifest.root];
      const descriptor = verified.manifest.components.find(
        (component) => component.digest === verified.manifest.root,
      )?.descriptor;
      if (!descriptor)
        throw new DomainError("closure_unavailable", "Package root unavailable", 409);
      const release = await tx.put<Release>("release", releaseId, {
        namespace: candidate.data.namespace,
        name: candidate.data.name,
        summary: candidate.data.summary,
        tags: candidate.data.tags,
        authorName: candidate.data.authorName,
        organizationName: candidate.data.organizationName,
        version: candidate.data.version,
        root: candidate.data.root,
        closureDigest: candidate.data.closureDigest,
        permissions: descriptor.permissions,
        capabilities: definition
          ? [
              ...new Set(
                Object.values(definition.runtimeSlots).flatMap((slot) => slot.capabilities),
              ),
            ].sort()
          : [],
        format: descriptor.schema,
        harness: definition
          ? [...new Set(Object.values(definition.runtimeSlots).map((slot) => slot.harness))]
          : [],
        changelog: descriptor.changelog,
        publishedAt: (await tx.now()).toISOString(),
        status: "active",
        policyGeneration: 0,
        reasonCategory: null,
      });
      await tx.put<Publication>("publication", releaseId, {
        organizationId: meta.organizationId,
        actorId: actor.userId,
        candidateId: candidate.id,
        archiveBase64: candidate.data.archiveBase64,
        authorityGeneration: actor.authorityGeneration,
      });
      await tx.emit("community.release_published", release, {
        releaseId,
        root: release.data.root,
        closureDigest: release.data.closureDigest,
      });
      return this.publicRelease(release, tx);
    });
  }
  private async publicRelease(
    release: RecordEnvelope<Release>,
    tx: {
      get<T>(kind: string, id: string): Promise<RecordEnvelope<T> | undefined>;
      all<T>(kind: string, filter?: Record<string, unknown>): Promise<RecordEnvelope<T>[]>;
    },
  ) {
    if (release.data.status !== "active")
      return {
        id: release.id,
        aggregateVersion: release.version,
        namespace: release.data.namespace,
        name: release.data.name,
        version: release.data.version,
        status: release.data.status,
        reasonCategory: release.data.reasonCategory,
        policyGeneration: release.data.policyGeneration,
      };
    const publication = await tx.get<Publication>("publication", release.id);
    const packageKey = `${release.data.namespace}/${release.data.name}`;
    const ratings = (await tx.all<Rating>("rating", { packageKey })).filter(
      (item) => item.data.packageKey === packageKey,
    );
    const eligible: number[] = [];
    for (const rating of ratings)
      if (
        publication &&
        !(await this.authority.isMember(rating.data.actorId, publication.data.organizationId))
      )
        eligible.push(rating.data.score);
    return {
      id: release.id,
      aggregateVersion: release.version,
      ...release.data,
      rating: {
        count: eligible.length,
        average: eligible.length ? eligible.reduce((a, b) => a + b, 0) / eligible.length : null,
      },
    };
  }
  search(query: { q?: string; sort?: string; tag?: string; author?: string; harness?: string }) {
    return this.store.read(PUBLIC_ORGANIZATION, async (tx) => {
      const matching = (await tx.all<Release>("release", { status: "active" })).filter(
        (item) =>
          item.data.status === "active" &&
          (!query.q ||
            `${item.data.name} ${item.data.summary}`
              .toLowerCase()
              .includes(query.q.toLowerCase())) &&
          (!query.tag || item.data.tags.includes(query.tag)) &&
          (!query.author ||
            item.data.authorName === query.author ||
            item.data.organizationName === query.author) &&
          (!query.harness || item.data.harness.includes(query.harness)),
      );
      const items = await Promise.all(matching.map((release) => this.publicRelease(release, tx)));
      const relevance = (item: { name: string; summary?: string }) => {
        const q = query.q?.toLowerCase() ?? "";
        return !q
          ? 0
          : item.name.toLowerCase() === q
            ? 4
            : item.name.toLowerCase().startsWith(q)
              ? 3
              : item.name.toLowerCase().includes(q)
                ? 2
                : 1;
      };
      items.sort((a, b) =>
        query.sort === "relevance" && relevance(a) !== relevance(b)
          ? relevance(b) - relevance(a)
          : query.sort === "rating" && "rating" in a && "rating" in b
            ? (b.rating.average ?? 0) - (a.rating.average ?? 0) || b.rating.count - a.rating.count
            : "publishedAt" in a && "publishedAt" in b
              ? b.publishedAt.localeCompare(a.publishedAt)
              : a.id.localeCompare(b.id),
      );
      return { items };
    });
  }
  read(id: string) {
    return this.store.read(PUBLIC_ORGANIZATION, async (tx) => {
      const release = await tx.require<Release>("release", id);
      const data = await this.publicRelease(release, tx);
      if (release.data.status !== "active") return { ...data, comments: [] };
      const comments = (await tx.all<Comment>("comment", { releaseId: id }))
        .filter((item) => item.data.releaseId === id)
        .map((item) => ({
          id: item.id,
          version: item.version,
          actorId: item.data.actorId,
          parentId: item.data.parentId,
          body: item.data.deleted || item.data.hidden ? null : item.data.body,
          edited: item.data.edited,
          status: item.data.hidden ? "hidden" : item.data.deleted ? "deleted" : "active",
          createdAt: item.createdAt,
        }));
      return { ...data, comments };
    });
  }
  archive(id: string) {
    return this.store.read(PUBLIC_ORGANIZATION, async (tx) => {
      const release = await tx.require<Release>("release", id);
      if (release.data.status !== "active")
        throw new DomainError(
          "release_unavailable",
          "This release is withdrawn or quarantined",
          410,
        );
      return (await tx.require<Publication>("publication", id)).data.archiveBase64;
    });
  }
  async import(meta: CommandMeta, id: string) {
    return this.catalog.importPackage(meta, await this.archive(id));
  }
  async fork(meta: CommandMeta, id: string, title: string) {
    const imported = await this.catalog.importPackage(
      { ...meta, operation: "fork_import" },
      await this.archive(id),
    );
    return this.catalog.forkPackage(meta, imported.id, title, true);
  }
  rating(meta: CommandMeta, releaseId: string, score: number, reviewedVersion: string) {
    return this.store.command(publicMeta(meta), async (tx) => {
      const release = await tx.require<Release>("release", releaseId);
      const publication = await tx.require<Publication>("publication", releaseId);
      if (release.data.status !== "active" || reviewedVersion !== release.data.version)
        throw new DomainError("release_mismatch", "Rate an available exact reviewed version", 409);
      if (await this.authority.isMember(meta.actorId, publication.data.organizationId))
        throw new DomainError(
          "rating_conflict",
          "Current publishing organization members cannot rate this package",
          403,
        );
      const packageKey = `${release.data.namespace}/${release.data.name}`;
      const id = identityId({ rating: packageKey, actor: meta.actorId });
      const previous = await tx.get("rating", id);
      return tx.put<Rating>(
        "rating",
        id,
        { actorId: meta.actorId, packageKey, releaseId, score, reviewedVersion },
        previous?.version ?? 0,
      );
    });
  }
  comment(meta: CommandMeta, releaseId: string, body: string, parentId?: string) {
    return this.store.command(publicMeta(meta), async (tx) => {
      const release = await tx.require<Release>("release", releaseId);
      if (release.data.status !== "active")
        throw new DomainError("release_unavailable", "Release is unavailable", 410);
      if (parentId && (await tx.require<Comment>("comment", parentId)).data.releaseId !== releaseId)
        throw new DomainError(
          "parent_mismatch",
          "Replies must remain in the same release thread",
          409,
        );
      return tx.put<Comment>("comment", randomUUID(), {
        releaseId,
        actorId: meta.actorId,
        body,
        parentId: parentId ?? null,
        edited: false,
        deleted: false,
        hidden: false,
      });
    });
  }
  editComment(meta: CommandMeta, id: string, expectedVersion: number, body: string | null) {
    return this.store.command(publicMeta(meta), async (tx) => {
      const comment = await tx.require<Comment>("comment", id);
      if (comment.data.actorId !== meta.actorId)
        throw new DomainError("forbidden", "Only the author can edit this comment", 403);
      return tx.put(
        "comment",
        id,
        { ...comment.data, body, edited: true, deleted: body === null },
        expectedVersion,
      );
    });
  }
  bookmark(meta: CommandMeta, releaseId: string, saved: boolean) {
    return this.store.command(publicMeta(meta), async (tx) => {
      await tx.require<Release>("release", releaseId);
      const id = identityId({ bookmark: releaseId, actor: meta.actorId });
      const prior = await tx.get("bookmark", id);
      return tx.put(
        "bookmark",
        id,
        { actorId: meta.actorId, releaseId, saved },
        prior?.version ?? 0,
      );
    });
  }
  bookmarks(actorId: string) {
    return this.store.read(PUBLIC_ORGANIZATION, async (tx) => ({
      items: (
        await tx.all<{ actorId: string; releaseId: string; saved: boolean }>("bookmark", {
          actorId,
          saved: true,
        })
      ).filter((item) => item.data.actorId === actorId && item.data.saved),
    }));
  }
  report(
    meta: CommandMeta,
    body: {
      targetType: string;
      targetId: string;
      category: string;
      explanation: string;
      evidence: string[];
    },
  ) {
    return this.store.command(publicMeta(meta), (tx) =>
      tx.put("report", randomUUID(), { ...body, reporterId: meta.actorId, status: "open" }),
    );
  }
  async moderate(
    meta: CommandMeta,
    actor: Actor,
    body: {
      targetId: string;
      action: Decision["action"];
      expectedVersion: number;
      reason: string;
      category: string;
    },
  ) {
    return this.store.command(publicMeta(meta), async (tx) => {
      const targetKind =
        body.action === "hide_comment"
          ? "comment"
          : body.action.includes("namespace")
            ? "namespace"
            : "release";
      const target = await tx.require<Release & { organizationId?: string }>(
        targetKind,
        body.targetId,
      );
      const publisherOperation =
        body.action === "withdraw" ||
        (body.action === "restore" && target.data.status === "withdrawn");
      await this.authority.recheck(actor, publisherOperation ? "publisher" : "moderator");
      if (
        publisherOperation &&
        (await tx.require<Publication>("publication", body.targetId)).data.organizationId !==
          actor.organizationId
      )
        throw new DomainError(
          "forbidden",
          "Only the owning organization can change its withdrawal",
          403,
        );
      if (target.version !== body.expectedVersion)
        throw new DomainError(
          "policy_conflict",
          "A later policy decision superseded this review",
          409,
          "never",
          target.version,
        );
      if (body.action === "withdraw") {
        const publication = await tx.require<Publication>("publication", body.targetId);
        if (publication.data.organizationId !== actor.organizationId)
          throw new DomainError(
            "forbidden",
            "Only the owning organization can withdraw this release",
            403,
          );
        if (target.data.status === "quarantined")
          throw new DomainError(
            "independent_hold",
            "Publisher withdrawal cannot clear a moderator quarantine",
            409,
          );
      }
      const updated =
        body.action === "hide_comment"
          ? { ...target.data, hidden: true }
          : targetKind === "namespace"
            ? {
                ...target.data,
                suspended: body.action === "suspend_namespace",
                policyVersion:
                  ((target.data as unknown as { policyVersion: number }).policyVersion ?? 0) + 1,
              }
            : {
                ...target.data,
                status:
                  body.action === "restore"
                    ? "active"
                    : body.action === "quarantine"
                      ? "quarantined"
                      : "withdrawn",
                policyGeneration: target.data.policyGeneration + 1,
                reasonCategory: body.action === "restore" ? null : body.category,
              };
      const saved = await tx.put(targetKind, target.id, updated, target.version);
      const decision = await tx.put<Decision>("decision", randomUUID(), {
        targetId: target.id,
        action: body.action,
        actorId: actor.userId,
        organizationId: actor.organizationId,
        reason: body.reason,
        category: body.category,
        priorVersion: target.version,
        resultingVersion: saved.version,
      });
      if (targetKind === "release")
        await tx.emit("community.release_policy_changed", saved, {
          releaseId: target.id,
          root: target.data.root,
          components: [target.data.root],
          policyGeneration: (updated as Release).policyGeneration,
          status: (updated as Release).status,
          decisionId: decision.id,
        });
      return decision;
    });
  }
  appeal(meta: CommandMeta, decisionId: string, explanation: string) {
    return this.store.command(publicMeta(meta), async (tx) => {
      const decision = await tx.require<Decision>("decision", decisionId);
      const publication = await tx.get<Publication>("publication", decision.data.targetId);
      const comment = await tx.get<Comment>("comment", decision.data.targetId);
      if (
        !(
          publication &&
          (await this.authority.isMember(meta.actorId, publication.data.organizationId))
        ) &&
        comment?.data.actorId !== meta.actorId
      )
        throw new DomainError(
          "forbidden",
          "Only the affected publisher or commenter may appeal",
          403,
        );
      return tx.put("appeal", randomUUID(), {
        decisionId,
        actorId: meta.actorId,
        explanation,
        status: "pending",
      });
    });
  }
  decideAppeal(
    meta: CommandMeta,
    actor: Actor,
    id: string,
    body: {
      expectedVersion: number;
      outcome: "upheld" | "restoration_permitted";
      reason: string;
      sameReviewerReason?: string;
    },
  ) {
    return this.store.command(publicMeta(meta), async (tx) => {
      await this.authority.recheck(actor, "moderator");
      const appeal = await tx.require<{
        decisionId: string;
        actorId: string;
        explanation: string;
        status: string;
      }>("appeal", id);
      const decision = await tx.require<Decision>("decision", appeal.data.decisionId);
      if (appeal.data.status !== "pending")
        throw new DomainError(
          "appeal_decided",
          "This appeal already has an accepted decision",
          409,
        );
      if (decision.data.actorId === actor.userId && !body.sameReviewerReason)
        throw new DomainError(
          "independent_review_required",
          "Use a different moderator or record why service-admin review is necessary",
          409,
        );
      const saved = await tx.put(
        "appeal",
        id,
        {
          ...appeal.data,
          status: "decided",
          outcome: body.outcome,
          reason: body.reason,
          reviewedBy: actor.userId,
          sameReviewerReason: body.sameReviewerReason ?? null,
        },
        body.expectedVersion,
      );
      await tx.put("appeal_decision", randomUUID(), {
        appealId: id,
        decisionId: decision.id,
        moderatorId: actor.userId,
        outcome: body.outcome,
        reason: body.reason,
        expectedPolicyVersion: decision.data.resultingVersion,
      });
      return saved;
    });
  }
  moderationQueue() {
    return this.store.read(PUBLIC_ORGANIZATION, async (tx) => ({
      reports: await tx.all<{
        targetType: string;
        targetId: string;
        category: string;
        explanation: string;
        evidence: string[];
        reporterId: string;
        status: string;
      }>("report"),
      appeals: await tx.all<{
        decisionId: string;
        actorId: string;
        explanation: string;
        status: string;
        outcome?: "upheld" | "restoration_permitted";
        reason?: string;
        reviewedBy?: string;
        sameReviewerReason?: string | null;
      }>("appeal"),
      decisions: await tx.all<Decision>("decision"),
    }));
  }
}
