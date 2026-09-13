import { createHmac, timingSafeEqual } from "node:crypto";
import { type Actor, DomainError, type Message } from "@aa/platform/contracts";
import { digest, newId } from "@aa/platform/crypto";
import { type ApiRouter, envelope } from "@aa/platform/http";
import type { ContextStore, RecordEnvelope } from "@aa/platform/store";
import { z } from "zod";
import { artifactRefSchema } from "../../../packages/runner/src/protocol.ts";
import { type GithubJob, GithubJobIdentity } from "./github-identity.ts";
import {
  type HealthObservationPort,
  HttpHealthObservation,
  healthFailureSchema,
} from "./health-observation.ts";
import {
  assertConsumerAuthority,
  type ConsumerAuthority,
  installProjectCheckpoint,
  type ProjectCheckpoint,
} from "./project-consumer.ts";
import { type Repository, repositorySchema } from "./projects.ts";

export const effectIntentSchema = z.strictObject({
  effectId: z.uuid(),
  runId: z.uuid(),
  path: z.string(),
  action: z.enum([
    "publishPR",
    "waitMerge",
    "staging",
    "production",
    "verifyHealth",
    "recoverProduction",
  ]),
  input: z.json(),
  manifestDigest: z.string(),
  deadline: z.iso.datetime(),
  deliveryId: z.uuid(),
  projectId: z.uuid(),
  repositoryRegistrationId: z.uuid(),
  repository: repositorySchema,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
});
export type EffectIntent = z.infer<typeof effectIntentSchema>;
type EffectStatus =
  | "pending"
  | "dispatching"
  | "waiting"
  | "outcome_unknown"
  | "completed"
  | "failed";
interface Effect {
  intent: EffectIntent;
  status: EffectStatus;
  phase: string;
  reason?: string;
  output?: z.infer<ReturnType<typeof z.json>>;
  providerRunId?: number;
  providerRunAttempt?: number;
  workflow?: DeploymentProfile;
  createdAt: string;
  observation?: { content: string; mediaType: string };
  recovery?: {
    failedEffectId: string;
    releaseId: string;
    artifactDigest: string;
    sourceCommit: string;
    environmentGeneration: number;
  };
}
interface PullRequestMapping {
  deliveryId: string;
  repositoryProviderId: string;
  number: number;
  url: string;
  head: string;
  commit: string;
  effectId: string;
}
interface IssueRoute {
  projectId: string;
  repositoryId: string;
  repositoryProviderId: string;
  label: string;
  actorId: string;
  playbookVersionId?: string;
  active: boolean;
}
export const deploymentProfileSchema = z.strictObject({
  repositoryId: z.uuid(),
  environment: z.enum(["staging", "production"]),
  workflowPath: z.string().regex(/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/),
  workflowRef: z.string().min(1).max(160),
  workflowRevision: z.string().regex(/^[a-f0-9]{40}$/),
  environmentRevision: z.string().min(1).max(160),
  healthUrl: z.url(),
  expectedStatus: z.int().min(100).max(599).default(200),
  accountId: z.string().regex(/^\d{12}$/),
  stackName: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,127}$/),
  region: z.literal("eu-west-1"),
  rollbackWorkflowPath: z
    .string()
    .regex(/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/)
    .optional(),
  expectedPreviousArtifact: z.string().nullable(),
  policyGeneration: z.int().positive(),
});
type DeploymentProfile = z.infer<typeof deploymentProfileSchema>;
const deploymentPolicyRefSchema = z.strictObject({
  profileDigest: z.string(),
  environmentRevision: z.string(),
  policyGeneration: z.int().positive(),
  accountId: z.string(),
  stackName: z.string(),
});
function policyReference(profile: DeploymentProfile) {
  return {
    profileDigest: digest(profile),
    environmentRevision: profile.environmentRevision,
    policyGeneration: profile.policyGeneration,
    accountId: profile.accountId,
    stackName: profile.stackName,
  };
}
export interface IntegrationConfig {
  githubToken?: string;
  webhookSecret?: string;
  apiBase?: string;
  oidcAudience?: string;
  oidcIssuer?: string;
  oidcJwksUrl?: string;
  health?: HealthObservationPort;
  authorizeConsumer(organizationId: string, projectId: string): Promise<ConsumerAuthority>;
  repository(organizationId: string, repositoryId: string): Promise<Repository>;
  authorizeEffect(organizationId: string, effect: EffectIntent): Promise<void>;
  startFromIssue(
    organizationId: string,
    input: {
      projectId: string;
      repositoryId: string;
      issue: { id: string; number: number; title: string; body: string; url: string };
      deliveryKey: string;
      actorId: string;
      playbookVersionId?: string;
      starterKind?: "new-feature" | "bug-fix";
    },
  ): Promise<{ runId: string; status?: "pending" | "admitted" }>;
  createArtifact(
    organizationId: string,
    input: { operationId: string; mediaType: string; content: string; runId: string },
  ): Promise<z.infer<typeof artifactRefSchema>>;
}
class ProviderUncertain extends Error {
  constructor() {
    super("provider_outcome_unknown");
  }
}
export class GithubProvider {
  constructor(
    private token?: string,
    readonly base = "https://api.github.com",
  ) {}
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      throw new ProviderUncertain();
    }
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok) throw new ProviderUncertain();
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new ProviderUncertain();
    }
  }
  path(repository: Repository) {
    return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  }
  async verify(repository: Repository): Promise<void> {
    const value = z
      .object({
        id: z.number(),
        owner: z.object({ id: z.number(), login: z.string() }),
        name: z.string(),
      })
      .passthrough()
      .parse(await this.request("GET", this.path(repository)));
    if (
      String(value.id) !== repository.providerId ||
      String(value.owner.id) !== repository.ownerId ||
      value.owner.login !== repository.owner ||
      value.name !== repository.name
    )
      throw new DomainError(
        "repository_identity_changed",
        "Repository identity changed and requires project revalidation",
        409,
      );
  }
}
const effectViewSchema = z.strictObject({
  intent: effectIntentSchema,
  status: z.enum(["pending", "dispatching", "waiting", "outcome_unknown", "completed", "failed"]),
  phase: z.string(),
  reason: z.string().optional(),
  output: z.json().optional(),
  providerRunId: z.number().optional(),
  providerRunAttempt: z.number().optional(),
  workflow: deploymentProfileSchema.optional(),
  createdAt: z.iso.datetime(),
  observation: z.strictObject({ content: z.string(), mediaType: z.string() }).optional(),
  recovery: z
    .strictObject({
      failedEffectId: z.uuid(),
      releaseId: z.uuid(),
      artifactDigest: z.string(),
      sourceCommit: z.string(),
      environmentGeneration: z.int().positive(),
    })
    .optional(),
});
export class Integrations {
  readonly provider: GithubProvider;
  readonly identity: GithubJobIdentity;
  readonly healthReader: HealthObservationPort;
  constructor(
    readonly store: ContextStore,
    readonly config: IntegrationConfig,
  ) {
    this.provider = new GithubProvider(config.githubToken, config.apiBase);
    this.healthReader = config.health ?? new HttpHealthObservation();
    this.identity = new GithubJobIdentity(
      config.oidcAudience,
      config.oidcIssuer,
      config.oidcJwksUrl,
    );
  }
  installProjectCheckpoint(org: string, checkpoint: ProjectCheckpoint) {
    return installProjectCheckpoint(this.store, org, checkpoint);
  }
  async reserveIssueStart(
    org: string,
    input: Parameters<IntegrationConfig["startFromIssue"]>[1],
    sourceCommit: string,
  ) {
    const source = z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(sourceCommit);
    const initial = await this.store.command(
      {
        organizationId: org,
        actorId: input.actorId,
        operation: "issue-intent",
        operationId: input.deliveryKey,
        request: { deliveryKey: input.deliveryKey },
      },
      (tx) => tx.put("issue-intent", newId(), { input, sourceCommit: source }),
    );
    if (
      initial.data.input.projectId !== input.projectId ||
      initial.data.input.repositoryId !== input.repositoryId ||
      (initial.data.input.starterKind ?? "new-feature") !== (input.starterKind ?? "new-feature")
    )
      throw new DomainError(
        "issue_start_scope_conflict",
        "The existing issue delivery uses a different project, repository or starter",
        409,
      );
    return initial;
  }
  async startVerifiedIssue(
    actor: Actor,
    input: {
      projectId: string;
      repositoryId: string;
      issueNumber: number;
      starter: "new-feature" | "bug-fix";
    },
    operationId: string,
  ) {
    const repository = await this.config.repository(actor.organizationId, input.repositoryId);
    if (repository.projectId !== input.projectId || repository.status !== "active")
      throw new DomainError(
        "issue_repository_unavailable",
        "The registered repository does not belong to this active project",
        403,
      );
    await this.provider.verify(repository);
    const issue = z
      .object({
        id: z.number().int().positive(),
        number: z.number().int().positive(),
        title: z.string(),
        body: z.string().nullable(),
        html_url: z.url(),
        pull_request: z.unknown().optional(),
      })
      .passthrough()
      .parse(
        await this.provider.request(
          "GET",
          `${this.provider.path(repository)}/issues/${input.issueNumber}`,
        ),
      );
    if (issue.number !== input.issueNumber || issue.pull_request !== undefined)
      throw new DomainError(
        "github_issue_required",
        "Select a GitHub issue, not a pull request",
        400,
      );
    const selected = {
      projectId: input.projectId,
      repositoryId: input.repositoryId,
      issue: {
        id: String(issue.id),
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        url: issue.html_url,
      },
      deliveryKey: `github-issue:${repository.providerId}:${issue.id}`,
      actorId: actor.userId,
      starterKind: input.starter,
    };
    const pinned = await this.store.command(
      {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        operation: "verified-issue-request",
        operationId,
        request: input,
      },
      (tx) => tx.put("verified-issue-request", newId(), selected),
    );
    return this.config.startFromIssue(actor.organizationId, pinned.data);
  }
  async accept(message: Message) {
    return this.store.consume(message, async (tx) => {
      if (message.type === "execution.effect_requested") {
        const intent = effectIntentSchema.parse(message.payload),
          existing = await tx.get<Effect>("effect", intent.effectId);
        if (existing) {
          if (digest(existing.data.intent) !== digest(intent))
            throw new DomainError(
              "effect_identity_conflict",
              "The effect identity already binds different immutable input",
              409,
            );
          return { accepted: true };
        }
        await tx.put("effect", intent.effectId, {
          intent,
          status: "pending",
          phase: "lookup",
          createdAt: (await tx.now()).toISOString(),
        } satisfies Effect);
      }
      if (message.type === "projects.policy_changed") {
        const scope = z
          .object({ projectId: z.string(), epoch: z.int(), status: z.string() })
          .passthrough()
          .parse(message.payload);
        const prior = await tx.get<{ epoch: number; status: string }>(
          "project-gate",
          scope.projectId,
        );
        if (!prior || prior.data.epoch < scope.epoch) {
          const gate = await tx.put(
            "project-gate",
            scope.projectId,
            { epoch: scope.epoch, status: scope.status },
            prior?.version ?? 0,
          );
          if (["suspending", "suspended"].includes(scope.status))
            await tx.emit("integrations.project_cutoff", gate, {
              projectId: scope.projectId,
              epoch: scope.epoch,
            });
        }
      }
      return { accepted: true };
    });
  }
  private async save(
    organizationId: string,
    effectId: string,
    operation: string,
    work: (data: Effect) => Promise<Effect> | Effect,
  ): Promise<RecordEnvelope<Effect>> {
    return this.store.command(
      {
        organizationId,
        actorId: "integrations",
        operation,
        operationId: newId(),
        request: { effectId },
      },
      async (tx) => {
        const row = await tx.require<Effect>("effect", effectId);
        return tx.put("effect", row.id, await work(row.data), row.version);
      },
    );
  }
  private async result(
    org: string,
    effectId: string,
    status: "completed" | "failed" | "outcome_unknown" | "waiting",
    output?: unknown,
    reason?: string,
  ): Promise<void> {
    await this.store.command(
      {
        organizationId: org,
        actorId: "integrations",
        operation: "effect-verdict",
        operationId: newId(),
        request: {
          effectId,
          status,
          ...(output === undefined ? {} : { output }),
          ...(reason ? { reason } : {}),
        },
      },
      async (tx) => {
        const current = await tx.require<Effect>("effect", effectId);
        if (["completed", "failed"].includes(current.data.status)) return;
        if (
          current.data.status === status &&
          current.data.reason === reason &&
          digest(current.data.output ?? null) === digest(output ?? null)
        )
          return;
        const data = {
          ...current.data,
          status,
          ...(output === undefined ? {} : { output: z.json().parse(output) }),
          ...(reason ? { reason } : {}),
        };
        const row = await tx.put("effect", effectId, data, current.version);
        await tx.emit("integrations.effect_result", row, {
          runId: data.intent.runId,
          path: data.intent.path,
          effectId,
          status,
          ...(output === undefined ? {} : { output: z.json().parse(output) }),
          ...(reason ? { reason } : {}),
        });
      },
    );
  }
  private async claim(org: string, effectId: string, phase: string): Promise<boolean> {
    const target = await this.store.read(org, (tx) => tx.require<Effect>("effect", effectId)),
      authority = await this.config.authorizeConsumer(org, target.data.intent.projectId);
    return this.store.command(
      {
        organizationId: org,
        actorId: "integrations",
        operation: `effect-claim:${phase}`,
        operationId: newId(),
        request: { effectId },
      },
      async (tx) => {
        await assertConsumerAuthority(tx, authority);
        const current = await tx.require<Effect>("effect", effectId);
        if (["completed", "failed", "dispatching", "outcome_unknown"].includes(current.data.status))
          return false;
        if (Date.parse(current.data.intent.deadline) <= (await tx.now()).getTime())
          throw new DomainError(
            "effect_authority_expired",
            "The finite effect authority expired",
            409,
          );
        if (
          ["suspending", "suspended"].includes(
            (await tx.get<{ status: string }>("project-gate", current.data.intent.projectId))?.data
              .status ?? "",
          )
        )
          throw new DomainError("project_suspended", "The project effect cutoff is active", 409);
        await tx.put(
          "effect",
          effectId,
          { ...current.data, status: "dispatching", phase },
          current.version,
        );
        return true;
      },
    );
  }
  async tick(organizationId: string): Promise<void> {
    const pending = await this.store.read(organizationId, async (tx) =>
      (await tx.all<Effect>("effect")).filter(
        (row) => !["completed", "failed"].includes(row.data.status),
      ),
    );
    for (const row of pending) {
      try {
        if (row.data.status === "pending")
          await this.config.authorizeEffect(organizationId, row.data.intent);
        if (row.data.intent.action === "publishPR") await this.publish(organizationId, row);
        else if (row.data.intent.action === "waitMerge") await this.waitMerge(organizationId, row);
        else if (["staging", "production"].includes(row.data.intent.action))
          await this.deploy(organizationId, row);
        else if (row.data.intent.action === "verifyHealth") await this.health(organizationId, row);
        else await this.recover(organizationId, row);
      } catch (error) {
        const current = await this.store.read(organizationId, (tx) =>
          tx.require<Effect>("effect", row.id),
        );
        const mayHaveWritten = current.data.phase !== "lookup";
        const definitiveInvalidInput =
          error instanceof z.ZodError ||
          (error instanceof DomainError &&
            ["publication_repository_mismatch", "effect_authority_expired"].includes(error.code));
        await this.result(
          organizationId,
          row.id,
          mayHaveWritten ? "outcome_unknown" : definitiveInvalidInput ? "failed" : "waiting",
          undefined,
          error instanceof DomainError
            ? error.code
            : mayHaveWritten
              ? "provider_reconciliation_required"
              : definitiveInvalidInput
                ? "invalid_effect_input"
                : "provider_lookup_or_authority_unavailable",
        );
      }
    }
  }
  private async publish(org: string, row: RecordEnvelope<Effect>): Promise<void> {
    const { intent } = row.data;
    const input = z
      .object({
        checkpoint: z.object({
          repositoryId: z.string(),
          commit: z.string().regex(/^[a-f0-9]{40}$/),
          digest: z.string(),
        }),
        spec: artifactRefSchema,
        approval: z.object({
          approved: z.literal(true),
          receiptId: z.string(),
          manifestDigest: z.string(),
        }),
        deliveryKey: z.string(),
      })
      .passthrough()
      .parse(intent.input);
    const registered = await this.config.repository(org, intent.repositoryRegistrationId);
    if (
      registered.providerId !== intent.repository.providerId ||
      registered.ownerId !== intent.repository.ownerId ||
      registered.projectId !== intent.projectId ||
      registered.status !== "active" ||
      input.checkpoint.repositoryId !== registered.providerId
    )
      throw new DomainError(
        "publication_repository_mismatch",
        "The approved checkpoint does not target this delivery repository",
        403,
      );
    await this.provider.verify(intent.repository);
    const path = this.provider.path(intent.repository),
      head = `agents-assemble/${intent.deliveryId}`;
    const reference = z
      .object({ object: z.object({ sha: z.string() }) })
      .nullable()
      .parse(await this.provider.request("GET", `${path}/git/ref/heads/${head}`));
    if (reference?.object.sha !== input.checkpoint.commit) {
      if (["dispatching", "outcome_unknown"].includes(row.data.status)) {
        await this.result(org, row.id, "outcome_unknown", undefined, "branch_write_not_reconciled");
        return;
      }
      await this.config.authorizeEffect(org, intent);
      if (!(await this.claim(org, row.id, "branch_dispatch"))) return;
      await this.provider.request(
        reference ? "PATCH" : "POST",
        reference ? `${path}/git/refs/heads/${head}` : `${path}/git/refs`,
        reference
          ? { sha: input.checkpoint.commit, force: false }
          : { ref: `refs/heads/${head}`, sha: input.checkpoint.commit },
      );
      await this.save(org, row.id, "branch-observed", (data) => ({
        ...data,
        status: "waiting",
        phase: "branch_confirmed",
      }));
    } else if (row.data.phase === "branch_dispatch")
      await this.save(org, row.id, "branch-reconciled", (data) => ({
        ...data,
        status: "waiting",
        phase: "branch_confirmed",
      }));
    const marker = `<!-- agents-assemble:delivery:${intent.deliveryId} -->`;
    const candidates = z
      .array(
        z
          .object({
            number: z.number().int(),
            html_url: z.string().url(),
            body: z.string().nullable(),
            head: z.object({ sha: z.string(), ref: z.string() }),
            base: z.object({ repo: z.object({ id: z.number() }) }).optional(),
          })
          .passthrough(),
      )
      .parse(
        await this.provider.request(
          "GET",
          `${path}/pulls?state=all&head=${encodeURIComponent(`${intent.repository.owner}:${head}`)}&per_page=100`,
        ),
      );
    const matching = candidates.filter((pr) => pr.body?.includes(marker) && pr.head.ref === head);
    if (matching.length > 1) {
      await this.result(
        org,
        row.id,
        "outcome_unknown",
        undefined,
        "ambiguous_pull_request_mapping",
      );
      return;
    }
    let pull = matching[0];
    if (!pull) {
      const latest = await this.store.read(org, (tx) => tx.require<Effect>("effect", row.id));
      if (["dispatching", "outcome_unknown"].includes(latest.data.status)) {
        await this.result(
          org,
          row.id,
          "outcome_unknown",
          undefined,
          "pull_request_creation_not_reconciled",
        );
        return;
      }
      await this.config.authorizeEffect(org, intent);
      if (!(await this.claim(org, row.id, "pull_request_dispatch"))) return;
      pull = z
        .object({
          number: z.number().int(),
          html_url: z.string().url(),
          body: z.string().nullable(),
          head: z.object({ sha: z.string(), ref: z.string() }),
        })
        .passthrough()
        .parse(
          await this.provider.request("POST", `${path}/pulls`, {
            title: `Agents Assemble delivery ${intent.deliveryId.slice(0, 8)}`,
            head,
            base: intent.repository.defaultBranch,
            body: `${marker}\n\nApproved specification: ${input.spec.id}@${input.spec.revisionId}\nCheckpoint: ${input.checkpoint.commit}\nDelivery: ${intent.deliveryId}`,
            draft: false,
          }),
        );
    }
    if (pull.head.sha !== input.checkpoint.commit) {
      await this.result(
        org,
        row.id,
        "outcome_unknown",
        undefined,
        "pull_request_checkpoint_mismatch",
      );
      return;
    }
    await this.store.command(
      {
        organizationId: org,
        actorId: "integrations",
        operation: "pull-request-mapping",
        operationId: row.id,
        request: { number: pull.number, url: pull.html_url, commit: pull.head.sha },
      },
      async (tx) => {
        const prior = await tx.get<PullRequestMapping>("pull-request", intent.deliveryId);
        if (prior && prior.data.number !== pull.number)
          throw new DomainError(
            "delivery_mapping_conflict",
            "A delivery cannot silently switch pull requests",
            409,
          );
        await tx.put(
          "pull-request",
          intent.deliveryId,
          {
            deliveryId: intent.deliveryId,
            repositoryProviderId: intent.repository.providerId,
            number: pull.number,
            url: pull.html_url,
            head,
            commit: pull.head.sha,
            effectId: row.id,
          } satisfies PullRequestMapping,
          prior?.version ?? 0,
        );
      },
    );
    await this.result(org, row.id, "completed", { pullRequest: pull.html_url });
  }
  private async waitMerge(org: string, row: RecordEnvelope<Effect>): Promise<void> {
    const mapping = await this.store.read(org, (tx) =>
      tx.get<PullRequestMapping>("pull-request", row.data.intent.deliveryId),
    );
    if (!mapping) {
      await this.result(org, row.id, "waiting", undefined, "pull_request_mapping_pending");
      return;
    }
    const pull = z
      .object({
        merged: z.boolean(),
        merge_commit_sha: z.string().nullable(),
        head: z.object({ sha: z.string() }),
      })
      .passthrough()
      .parse(
        await this.provider.request(
          "GET",
          `${this.provider.path(row.data.intent.repository)}/pulls/${mapping.data.number}`,
        ),
      );
    if (!pull.merged) {
      await this.result(org, row.id, "waiting", undefined, "human_merge_pending");
      return;
    }
    if (pull.head.sha !== mapping.data.commit)
      throw new DomainError(
        "merged_checkpoint_changed",
        "The human-merged pull request differs from the approved checkpoint",
        409,
      );
    const releases = await this.store.read(org, (tx) => tx.all<Release>("release"));
    const release = releases.find(
      (item) =>
        item.data.deliveryId === row.data.intent.deliveryId &&
        item.data.repositoryProviderId === row.data.intent.repository.providerId &&
        item.data.commit === pull.merge_commit_sha,
    );
    if (!release) {
      await this.result(org, row.id, "waiting", undefined, "verified_merged_build_pending");
      return;
    }
    await this.store.command(
      {
        organizationId: org,
        actorId: "integrations",
        operation: "delivery-build",
        operationId: row.id,
        request: { releaseId: release.id },
      },
      async (tx) => {
        const previous = await tx.get("delivery-build", row.data.intent.deliveryId);
        if (previous) {
          if (digest(previous.data) !== digest({ releaseId: release.id }))
            throw new DomainError(
              "delivery_build_immutable",
              "A delivery already retained a different immutable build",
              409,
            );
          return;
        }
        await tx.put("delivery-build", row.data.intent.deliveryId, { releaseId: release.id }, 0);
      },
    );
    const staging = await this.profile(
        org,
        row.data.intent.repository,
        "staging",
        release.data.workflowRevision,
      ),
      production = await this.profile(
        org,
        row.data.intent.repository,
        "production",
        release.data.workflowRevision,
      );
    if (!staging || !production) {
      await this.result(org, row.id, "waiting", undefined, "pinned_deployment_profiles_pending");
      return;
    }
    await this.result(org, row.id, "completed", {
      artifactDigest: release.data.artifactDigest,
      commit: release.data.commit,
      workflowRevision: release.data.workflowRevision,
      stagingPolicy: policyReference(staging),
      productionPolicy: policyReference(production),
    });
  }
  private async deploy(org: string, row: RecordEnvelope<Effect>): Promise<void> {
    const input = z
      .object({
        artifactDigest: z.string(),
        workflowRevision: z.string(),
        sourceCommit: z.string(),
        policy: deploymentPolicyRefSchema,
        approval: z
          .object({ approved: z.literal(true) })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .parse(row.data.intent.input);
    const build = await this.store.read(org, async (tx) => {
      const mapping = await tx.get<{ releaseId: string }>(
        "delivery-build",
        row.data.intent.deliveryId,
      );
      return mapping ? tx.get<Release>("release", mapping.data.releaseId) : undefined;
    });
    if (!build) {
      await this.result(org, row.id, "waiting", undefined, "verified_delivery_build_pending");
      return;
    }
    if (
      build.data.artifactDigest !== input.artifactDigest ||
      build.data.workflowRevision !== input.workflowRevision ||
      build.data.commit !== input.sourceCommit
    )
      throw new DomainError(
        "promotion_artifact_mismatch",
        "Promotion must use the exact retained delivery build",
        409,
      );
    if (row.data.intent.action === "production" && !input.approval)
      throw new DomainError(
        "production_approval_required",
        "Production requires exact accepted approval",
        403,
      );
    const profile =
      row.data.workflow ??
      (await this.profile(
        org,
        row.data.intent.repository,
        row.data.intent.action === "staging" ? "staging" : "production",
        input.workflowRevision,
        input.policy.profileDigest,
      ));
    if (!profile)
      throw new DomainError(
        "deployment_profile_missing",
        "Configure a pinned repository deployment workflow",
        409,
      );
    if (digest(policyReference(profile)) !== digest(input.policy))
      throw new DomainError(
        "approved_deployment_policy_changed",
        "The exact approved environment, account, stack or policy generation no longer matches",
        403,
      );
    if (!row.data.workflow)
      await this.save(org, row.id, "pin-deployment", (data) => ({ ...data, workflow: profile }));
    await this.dispatchWorkflow(org, row, profile, input.artifactDigest);
  }
  private async dispatchWorkflow(
    org: string,
    row: RecordEnvelope<Effect>,
    profile: DeploymentProfile,
    artifactDigest: string,
  ): Promise<void> {
    if (["workflow_dispatch", "claimed"].includes(row.data.phase) || row.data.providerRunId) {
      await this.reconcileDeployment(org, { ...row, data: { ...row.data, workflow: profile } });
      return;
    }
    await this.provider.verify(row.data.intent.repository);
    await this.config.authorizeEffect(org, row.data.intent);
    if (!(await this.claim(org, row.id, "workflow_dispatch"))) return;
    const result = z
      .object({ workflow_run_id: z.number().int() })
      .passthrough()
      .parse(
        await this.provider.request(
          "POST",
          `${this.provider.path(row.data.intent.repository)}/actions/workflows/${encodeURIComponent(profile.workflowPath)}/dispatches`,
          {
            ref: profile.workflowRef,
            return_run_details: true,
            inputs: {
              effect_id: row.id,
              manifest_digest: row.data.intent.manifestDigest,
              artifact_digest: artifactDigest,
              environment: profile.environment,
              environment_revision: profile.environmentRevision,
              policy_generation: String(profile.policyGeneration),
            },
          },
        ),
      );
    await this.save(org, row.id, "workflow-dispatched", (data) => ({
      ...data,
      status: "waiting",
      providerRunId: result.workflow_run_id,
      providerRunAttempt: 1,
    }));
    await this.result(org, row.id, "waiting", undefined, "deployment_receipt_pending");
  }
  private async profile(
    org: string,
    repository: Repository,
    environment: "staging" | "production",
    workflowRevision: string,
    profileDigest?: string,
  ): Promise<DeploymentProfile | undefined> {
    const profiles = await this.store.read(org, (tx) =>
      tx.all<DeploymentProfile>("deployment-profile"),
    );
    const matching: DeploymentProfile[] = [];
    for (const row of profiles.filter(
      (row) =>
        row.data.environment === environment &&
        row.data.workflowRevision === workflowRevision &&
        (!profileDigest || digest(row.data) === profileDigest),
    )) {
      const bound = await this.config.repository(org, row.data.repositoryId);
      if (
        bound.providerId === repository.providerId &&
        bound.ownerId === repository.ownerId &&
        bound.projectId === repository.projectId
      )
        matching.push(row.data);
    }
    if (matching.length > 1)
      throw new DomainError(
        "ambiguous_deployment_profile",
        "Select one immutable deployment profile for this repository and environment",
        409,
      );
    return matching[0];
  }
  private verifyJob(job: GithubJob, repository: Repository, profile: DeploymentProfile): void {
    const ref = profile.workflowRef.startsWith("refs/")
      ? profile.workflowRef
      : `refs/heads/${profile.workflowRef}`;
    if (
      job.repository_id !== repository.providerId ||
      job.repository_owner_id !== repository.ownerId ||
      job.repository !== `${repository.owner}/${repository.name}` ||
      job.workflow_sha !== profile.workflowRevision ||
      job.workflow_ref !==
        `${repository.owner}/${repository.name}/${profile.workflowPath}@${ref}` ||
      job.ref !== ref
    )
      throw new DomainError(
        "github_job_scope_mismatch",
        "The provider job differs from the pinned repository and workflow authority",
        403,
      );
  }
  private async reconcileDeployment(org: string, row: RecordEnvelope<Effect>): Promise<void> {
    const profile = row.data.workflow;
    if (!profile) throw new Error("missing_workflow");
    let runId = row.data.providerRunId;
    if (!runId) {
      const candidates = z
        .object({
          workflow_runs: z.array(
            z
              .object({
                id: z.number().int(),
                head_sha: z.string(),
                display_title: z.string(),
                path: z.string(),
                run_attempt: z.number().int(),
              })
              .passthrough(),
          ),
        })
        .passthrough()
        .parse(
          await this.provider.request(
            "GET",
            `${this.provider.path(row.data.intent.repository)}/actions/workflows/${encodeURIComponent(profile.workflowPath)}/runs?event=workflow_dispatch&per_page=100`,
          ),
        );
      const matches = candidates.workflow_runs.filter(
        (run) =>
          run.head_sha === profile.workflowRevision &&
          run.path === profile.workflowPath &&
          run.display_title.includes(row.id),
      );
      if (matches.length !== 1) {
        await this.result(
          org,
          row.id,
          "outcome_unknown",
          undefined,
          "workflow_dispatch_lookup_inconclusive",
        );
        return;
      }
      runId = matches[0].id;
      await this.save(org, row.id, "workflow-reconciled", (data) => ({
        ...data,
        status: "waiting",
        providerRunId: runId,
        providerRunAttempt: matches[0].run_attempt,
      }));
    }
    const receipt = await this.store.read(org, (tx) =>
      tx.get<DeploymentReceipt>("deployment-receipt", environmentIdentity(row.id, "receipt")),
    );
    if (!receipt) {
      await this.result(
        org,
        row.id,
        "waiting",
        undefined,
        "authenticated_provider_receipt_pending",
      );
      return;
    }
    if (
      receipt.data.runId !== runId ||
      receipt.data.manifestDigest !== row.data.intent.manifestDigest
    )
      throw new DomainError(
        "deployment_receipt_mismatch",
        "Provider receipt does not match the original effect",
        409,
      );
    const input =
      row.data.recovery ??
      z.object({ artifactDigest: z.string() }).passthrough().parse(row.data.intent.input);
    if (row.data.recovery) {
      await this.finishRecovery(org, row, receipt);
      return;
    }
    if (receipt.data.artifactDigest !== input.artifactDigest)
      throw new DomainError(
        "deployment_artifact_mismatch",
        "The deployment did not observe the approved artifact",
        409,
      );
    if (!receipt.data.healthy) {
      await this.result(
        org,
        row.id,
        "completed",
        row.data.intent.action === "staging"
          ? { healthy: false, deploymentId: row.id, artifactDigest: input.artifactDigest }
          : { deploymentId: row.id, artifactDigest: input.artifactDigest },
        "deployment_health_failed",
      );
      return;
    }
    await this.result(
      org,
      row.id,
      "completed",
      row.data.intent.action === "staging"
        ? { healthy: true, deploymentId: row.id, artifactDigest: input.artifactDigest }
        : { deploymentId: row.id, artifactDigest: input.artifactDigest },
    );
  }
  private async health(org: string, row: RecordEnvelope<Effect>): Promise<void> {
    const input = z
        .object({ deploymentId: z.uuid(), artifactDigest: z.string() })
        .passthrough()
        .parse(row.data.intent.input),
      deployment = await this.store.read(org, (tx) =>
        tx.require<Effect>("effect", input.deploymentId),
      );
    if (!deployment.data.workflow) throw new Error("deployment_profile_missing");
    if (
      deployment.data.intent.deliveryId !== row.data.intent.deliveryId ||
      deployment.data.intent.repository.providerId !== row.data.intent.repository.providerId
    )
      throw new DomainError(
        "deployment_lineage_mismatch",
        "Health verification must target this delivery lineage",
        403,
      );
    const deployed = z
      .object({ artifactDigest: z.string() })
      .passthrough()
      .parse(deployment.data.intent.input);
    if (deployed.artifactDigest !== input.artifactDigest)
      throw new DomainError(
        "health_artifact_mismatch",
        "Health verification must target the exact deployed artifact",
        403,
      );
    let observation = row.data.observation;
    if (!observation) {
      const response = await this.healthReader.read(deployment.data.workflow.healthUrl),
        observedArtifact = response.artifactDigest;
      observation = {
        mediaType: "application/json",
        content: JSON.stringify({
          deploymentId: input.deploymentId,
          artifactDigest: input.artifactDigest,
          url: deployment.data.workflow.healthUrl,
          status: response.status,
          failure: response.failure,
          expectedStatus: deployment.data.workflow.expectedStatus,
          healthy:
            response.failure === null &&
            response.status === deployment.data.workflow.expectedStatus &&
            observedArtifact === input.artifactDigest,
          observedArtifact: observedArtifact ?? null,
          observedAt: new Date().toISOString(),
        }),
      };
      await this.save(org, row.id, "health-observation", (data) => ({ ...data, observation }));
    }
    const healthy = z
      .object({ healthy: z.boolean() })
      .passthrough()
      .parse(JSON.parse(observation.content)).healthy;
    const evidence = await this.config.createArtifact(org, {
      operationId: row.id,
      ...observation,
      runId: row.data.intent.runId,
    });
    await this.result(org, row.id, "completed", { healthy, evidence });
  }
  private async manualRecovery(
    org: string,
    row: RecordEnvelope<Effect>,
    reason: string,
  ): Promise<void> {
    const evidence = await this.config.createArtifact(org, {
      operationId: row.id,
      mediaType: "application/json",
      content: JSON.stringify({
        effectId: row.id,
        request: row.data.intent.input,
        outcome: "manual_recovery",
        reason,
      }),
      runId: row.data.intent.runId,
    });
    await this.result(org, row.id, "completed", { outcome: "manual_recovery", evidence }, reason);
  }
  private async recover(org: string, row: RecordEnvelope<Effect>): Promise<void> {
    if (row.data.recovery && row.data.workflow) {
      await this.dispatchWorkflow(org, row, row.data.workflow, row.data.recovery.artifactDigest);
      return;
    }
    const input = z
      .object({ deploymentId: z.uuid(), evidence: artifactRefSchema })
      .passthrough()
      .parse(row.data.intent.input);
    const state = await this.store.read(org, async (tx) => {
      const failed = await tx.require<Effect>("effect", input.deploymentId),
        profile = failed.data.workflow;
      const claim = await tx.get<DeploymentClaim>(
        "deployment-claim",
        environmentIdentity(failed.id, "claim"),
      );
      const receipt = await tx.get<DeploymentReceipt>(
        "deployment-receipt",
        environmentIdentity(failed.id, "receipt"),
      );
      const environment = claim
        ? await tx.get<EnvironmentState>("deployment-environment", claim.data.environmentId)
        : undefined;
      const previous = environment?.data.previous,
        release = previous ? await tx.get<Release>("release", previous.releaseId) : undefined;
      const health = (await tx.all<Effect>("effect")).find(
        (item) =>
          item.data.intent.action === "verifyHealth" &&
          item.data.status === "completed" &&
          item.data.observation &&
          digest(
            z.object({ evidence: artifactRefSchema }).passthrough().parse(item.data.output)
              .evidence,
          ) === digest(input.evidence),
      );
      return { failed, profile, claim, receipt, environment, previous, release, health };
    });
    if (
      state.failed.data.intent.action !== "production" ||
      state.failed.data.intent.deliveryId !== row.data.intent.deliveryId ||
      state.failed.data.intent.projectId !== row.data.intent.projectId ||
      state.failed.data.intent.repository.providerId !== row.data.intent.repository.providerId
    )
      throw new DomainError(
        "rollback_lineage_mismatch",
        "Rollback must target this delivery's exact production effect",
        403,
      );
    if (!state.profile?.rollbackWorkflowPath) {
      await this.manualRecovery(org, row, "rollback_workflow_unconfigured");
      return;
    }
    if (!state.claim || !state.receipt || !state.environment || !state.previous || !state.release) {
      await this.manualRecovery(
        org,
        row,
        "retained_prior_release_or_provider_settlement_unavailable",
      );
      return;
    }
    const observation = state.health?.data.observation
      ? z
          .object({ deploymentId: z.string(), artifactDigest: z.string(), healthy: z.boolean() })
          .passthrough()
          .parse(JSON.parse(state.health.data.observation.content))
      : undefined;
    if (
      !observation ||
      observation.deploymentId !== state.failed.id ||
      observation.artifactDigest !== state.receipt.data.artifactDigest ||
      observation.healthy
    ) {
      await this.manualRecovery(org, row, "exact_failed_health_verification_unavailable");
      return;
    }
    const previous = state.previous,
      profile = state.profile,
      release = state.release,
      failedClaim = state.claim;
    if (
      state.environment.data.generation !== state.claim.data.environmentGeneration ||
      (state.environment.data.effectId && state.environment.data.effectId !== state.failed.id) ||
      (!state.environment.data.effectId &&
        state.environment.data.currentEffectId !== state.failed.id)
    )
      throw new DomainError(
        "rollback_environment_changed",
        "The failed production generation no longer owns this target",
        409,
      );
    if (
      state.release.data.repositoryProviderId !== row.data.intent.repository.providerId ||
      state.release.data.artifactDigest !== previous.artifactDigest ||
      previous.profile.accountId !== profile.accountId ||
      previous.profile.stackName !== profile.stackName ||
      previous.profile.region !== profile.region
    ) {
      await this.manualRecovery(org, row, "previous_release_target_or_configuration_unverifiable");
      return;
    }
    await this.config.authorizeEffect(org, row.data.intent);
    const workflow = deploymentProfileSchema.parse({
      ...profile,
      workflowPath: profile.rollbackWorkflowPath,
      environmentRevision: previous.profile.environmentRevision,
    });
    const pinned = await this.save(org, row.id, "pin-rollback", (data) => ({
      ...data,
      workflow,
      recovery: {
        failedEffectId: state.failed.id,
        releaseId: release.id,
        artifactDigest: previous.artifactDigest,
        sourceCommit: release.data.commit,
        environmentGeneration: failedClaim.data.environmentGeneration,
      },
    }));
    await this.dispatchWorkflow(org, pinned, workflow, previous.artifactDigest);
  }
  private async finishRecovery(
    org: string,
    row: RecordEnvelope<Effect>,
    receipt: RecordEnvelope<DeploymentReceipt>,
  ): Promise<void> {
    if (
      !row.data.recovery ||
      !row.data.workflow ||
      receipt.data.artifactDigest !== row.data.recovery.artifactDigest
    )
      throw new DomainError(
        "rollback_receipt_mismatch",
        "Rollback receipt must observe the retained prior artifact",
        409,
      );
    if (!receipt.data.healthy) {
      await this.manualRecovery(org, row, "rollback_provider_health_failed");
      return;
    }
    let observation = row.data.observation;
    if (!observation) {
      const response = await this.healthReader.read(row.data.workflow.healthUrl),
        artifact = response.artifactDigest;
      observation = {
        mediaType: "application/json",
        content: JSON.stringify({
          effectId: row.id,
          failedEffectId: row.data.recovery.failedEffectId,
          artifactDigest: row.data.recovery.artifactDigest,
          observedArtifact: artifact ?? null,
          status: response.status,
          failure: response.failure,
          healthy:
            response.failure === null &&
            response.status === row.data.workflow.expectedStatus &&
            artifact === row.data.recovery.artifactDigest,
          providerRunId: receipt.data.runId,
        }),
      };
      await this.save(org, row.id, "rollback-health-observation", (data) => ({
        ...data,
        observation,
      }));
    }
    const healthy = z
      .object({ healthy: z.boolean() })
      .passthrough()
      .parse(JSON.parse(observation.content)).healthy;
    const evidence = await this.config.createArtifact(org, {
      operationId: row.id,
      ...observation,
      runId: row.data.intent.runId,
    });
    await this.result(
      org,
      row.id,
      "completed",
      { outcome: healthy ? "rolled_back" : "manual_recovery", evidence },
      healthy ? "previous_release_verified" : "rollback_health_verification_failed",
    );
  }
  register(router: ApiRouter): void {
    router.add({
      method: "post",
      path: "/runs/from-issue",
      summary:
        "Start a selected first-party journey from an actual issue in a verified registered GitHub repository",
      body: z.strictObject({
        projectId: z.uuid(),
        repositoryId: z.uuid(),
        issueNumber: z.int().positive(),
        starter: z.enum(["new-feature", "bug-fix"]),
      }),
      response: z.strictObject({
        runId: z.uuid(),
        status: z.enum(["pending", "admitted"]).optional(),
      }),
      handler: (req) => this.startVerifiedIssue(req.actor, req.body, req.operationId),
    });

    router.add({
      method: "get",
      path: "/integrations/github/manifests/:organizationId/:effectId",
      summary: "Read the exact retained deployment manifest for the authenticated claimed workflow",
      auth: "public",
      response: z.strictObject({
        effectId: z.uuid(),
        manifestDigest: z.string(),
        artifactDigest: z.string(),
        sourceCommit: z.string(),
        artifactObject: z.strictObject({
          bucket: z.string(),
          key: z.string(),
          versionId: z.string(),
        }),
        templateDigest: z.string(),
        workflow: deploymentProfileSchema,
        environmentGeneration: z.int().positive(),
        authorityExpiresAt: z.iso.datetime(),
      }),
      handler: async (req) => {
        const org = z.uuid().parse(req.params.organizationId),
          effectId = z.uuid().parse(req.params.effectId),
          job = await this.identity.verify(req.request);
        return this.store.read(org, async (tx) => {
          const effect = await tx.require<Effect>("effect", effectId),
            claim = await tx.require<DeploymentClaim>(
              "deployment-claim",
              environmentIdentity(effectId, "claim"),
            );
          if (!effect.data.workflow)
            throw new DomainError(
              "deployment_profile_missing",
              "No pinned deployment profile is available",
              403,
            );
          this.verifyJob(job, effect.data.intent.repository, effect.data.workflow);
          if (
            Number(job.run_id) !== claim.data.runId ||
            Number(job.run_attempt) !== claim.data.runAttempt
          )
            throw new DomainError(
              "deployment_claim_mismatch",
              "Only the exact claimed workflow run may read its deployment manifest",
              403,
            );
          const releaseId =
              effect.data.recovery?.releaseId ??
              (
                await tx.require<{ releaseId: string }>(
                  "delivery-build",
                  effect.data.intent.deliveryId,
                )
              ).data.releaseId,
            release = await tx.require<Release>("release", releaseId);
          return {
            effectId,
            manifestDigest: effect.data.intent.manifestDigest,
            artifactDigest: release.data.artifactDigest,
            sourceCommit: release.data.commit,
            artifactObject: release.data.artifactObject,
            templateDigest: release.data.templateDigest,
            workflow: effect.data.workflow,
            environmentGeneration: claim.data.environmentGeneration,
            authorityExpiresAt: claim.data.authorityExpiresAt,
          };
        });
      },
    });
    const releaseBody = z.strictObject({
      deliveryId: z.uuid(),
      repositoryId: z.uuid(),
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
      workflowRevision: z.string().regex(/^[a-f0-9]{40}$/),
      artifactObject: z.strictObject({
        bucket: z.string().min(1).max(100),
        key: z.string().min(1).max(1024),
        versionId: z.string().min(1).max(1024),
      }),
      templateDigest: z.string().regex(/^[a-f0-9]{64}$/),
      runId: z.int().positive(),
      runAttempt: z.int().positive(),
    });
    router.add({
      method: "post",
      path: "/integrations/github/releases/:organizationId",
      summary: "Record an immutable merged build from the exact authenticated workflow identity",
      auth: "public",
      body: releaseBody,
      response: z.strictObject({ id: z.uuid(), artifactDigest: z.string(), commit: z.string() }),
      handler: async (req) => {
        const org = z.uuid().parse(req.params.organizationId),
          job = await this.identity.verify(req.request),
          repository = await this.config.repository(org, req.body.repositoryId);
        const profile = await this.profile(org, repository, "staging", req.body.workflowRevision);
        if (!profile)
          throw new DomainError(
            "trusted_build_profile_missing",
            "Configure the exact trusted build workflow before accepting its artifacts",
            403,
          );
        this.verifyJob(job, repository, profile);
        if (
          Number(job.run_id) !== req.body.runId ||
          Number(job.run_attempt) !== req.body.runAttempt
        )
          throw new DomainError(
            "build_identity_mismatch",
            "Build provenance must match the signed source commit and run attempt",
            403,
          );
        const mapping = await this.store.read(org, (tx) =>
          tx.require<PullRequestMapping>("pull-request", req.body.deliveryId),
        );
        if (mapping.data.repositoryProviderId !== repository.providerId)
          throw new DomainError(
            "build_repository_mismatch",
            "The delivery does not target this repository",
            403,
          );
        const merged = z
          .object({
            merged: z.literal(true),
            merge_commit_sha: z.string(),
            head: z.object({ sha: z.string() }),
          })
          .passthrough()
          .parse(
            await this.provider.request(
              "GET",
              `${this.provider.path(repository)}/pulls/${mapping.data.number}`,
            ),
          );
        if (merged.merge_commit_sha !== req.body.commit || merged.head.sha !== mapping.data.commit)
          throw new DomainError(
            "build_commit_mismatch",
            "The build must attest the human-merged approved checkpoint",
            403,
          );
        return this.store.command(
          {
            organizationId: org,
            actorId: `github:${job.run_id}:${job.run_attempt}`,
            operation: "verified-build",
            operationId: req.operationId,
            request: req.body,
          },
          async (tx) => {
            if (job.exp * 1000 <= (await tx.now()).getTime())
              throw new DomainError(
                "github_job_expired",
                "The provider identity expired before artifact acceptance",
                403,
              );
            const retained = (await tx.all<Release>("release")).filter(
              (item) => item.data.deliveryId === req.body.deliveryId,
            );
            if (retained.length) {
              const prior = retained[0];
              if (
                retained.length !== 1 ||
                digest(releaseBody.strip().parse(prior.data)) !== digest(req.body)
              )
                throw new DomainError(
                  "delivery_build_immutable",
                  "The delivery already retained an immutable build; a new artifact, object version or provider attempt cannot replace it",
                  409,
                );
              return {
                id: prior.id,
                artifactDigest: prior.data.artifactDigest,
                commit: prior.data.commit,
              };
            }
            const id = newId();
            await tx.put("release", id, {
              ...req.body,
              repositoryProviderId: repository.providerId,
              provenance: {
                repositoryOwnerId: repository.ownerId,
                workflowRef: job.workflow_ref,
                workflowSha: job.workflow_sha,
                runId: job.run_id,
                runAttempt: job.run_attempt,
              },
            });
            return { id, artifactDigest: req.body.artifactDigest, commit: req.body.commit };
          },
        );
      },
    });
    const claimBody = z.strictObject({
      effectId: z.uuid(),
      manifestDigest: z.string(),
      artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
      environmentRevision: z.string(),
      workflowRevision: z.string().regex(/^[a-f0-9]{40}$/),
      policyGeneration: z.int().positive(),
    });
    router.add({
      method: "post",
      path: "/integrations/github/claims/:organizationId",
      summary: "Consume one exact finite deployment claim after authenticating the pinned workflow",
      auth: "public",
      body: claimBody,
      response: z.strictObject({
        status: z.literal("claimed"),
        effectId: z.uuid(),
        artifactDigest: z.string(),
        environment: z.enum(["staging", "production"]),
        environmentGeneration: z.int().positive(),
        authorityExpiresAt: z.iso.datetime(),
      }),
      handler: async (req) => {
        const org = z.uuid().parse(req.params.organizationId),
          job = await this.identity.verify(req.request),
          effect = await this.store.read(org, (tx) =>
            tx.require<Effect>("effect", req.body.effectId),
          );
        if (
          !effect.data.workflow ||
          !["staging", "production", "recoverProduction"].includes(effect.data.intent.action)
        )
          throw new DomainError(
            "deployment_not_dispatched",
            "A dispatched deployment must exist before a workflow can claim it",
            403,
          );
        const profile = effect.data.workflow;
        this.verifyJob(job, effect.data.intent.repository, profile);
        await this.config.authorizeEffect(org, effect.data.intent);
        const authority = await this.config.authorizeConsumer(org, effect.data.intent.projectId);
        const input = z
          .object({
            artifactDigest: z.string(),
            approval: z
              .object({ approved: z.literal(true) })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .parse(effect.data.recovery ?? effect.data.intent.input);
        if (
          req.body.manifestDigest !== effect.data.intent.manifestDigest ||
          req.body.artifactDigest !== input.artifactDigest ||
          req.body.environmentRevision !== profile.environmentRevision ||
          req.body.workflowRevision !== profile.workflowRevision ||
          req.body.policyGeneration !== profile.policyGeneration ||
          (effect.data.intent.action === "production" && !input.approval)
        )
          throw new DomainError(
            "deployment_claim_mismatch",
            "Deployment authority binds the exact artifact, environment, workflow and policy generation",
            403,
          );
        return this.store.command(
          {
            organizationId: org,
            actorId: `github:${job.run_id}:${job.run_attempt}`,
            operation: "deployment-claim",
            operationId: req.operationId,
            request: req.body,
          },
          async (tx) => {
            await assertConsumerAuthority(tx, authority);
            const current = await tx.require<Effect>("effect", req.body.effectId),
              now = await tx.now();
            if (
              Date.parse(current.data.intent.deadline) <= now.getTime() ||
              job.exp * 1000 <= now.getTime()
            )
              throw new DomainError(
                "deployment_authority_expired",
                "Deployment authority expired before the claim committed",
                403,
              );
            if (
              ["suspending", "suspended"].includes(
                (await tx.get<{ status: string }>("project-gate", current.data.intent.projectId))
                  ?.data.status ?? "",
              )
            )
              throw new DomainError(
                "project_suspended",
                "The project effect cutoff is active",
                403,
              );
            const existing = await tx.get<DeploymentClaim>(
              "deployment-claim",
              environmentIdentity(current.id, "claim"),
            );
            if (existing)
              throw new DomainError(
                "deployment_claim_consumed",
                "A workflow run or rerun cannot consume an already claimed effect",
                409,
              );
            if (
              (current.data.providerRunId && current.data.providerRunId !== Number(job.run_id)) ||
              Number(job.run_attempt) !== (current.data.providerRunAttempt ?? 1)
            )
              throw new DomainError(
                "provider_run_mismatch",
                "The claim belongs to another dispatch",
                409,
              );
            const environmentId = environmentIdentity(
                current.data.intent.repository.providerId,
                profile.environment,
              ),
              environment = await tx.get<EnvironmentState>("deployment-environment", environmentId);
            const recovery = current.data.recovery;
            if (recovery) {
              if (
                !environment ||
                environment.data.generation !== recovery.environmentGeneration ||
                environment.data.previous?.releaseId !== recovery.releaseId ||
                (environment.data.effectId &&
                  environment.data.effectId !== recovery.failedEffectId) ||
                (!environment.data.effectId &&
                  environment.data.currentEffectId !== recovery.failedEffectId)
              )
                throw new DomainError(
                  "rollback_environment_changed",
                  "Rollback authority is bound to the exact failed generation and previous release",
                  409,
                );
            } else {
              if (environment?.data.effectId && environment.data.effectId !== current.id)
                throw new DomainError(
                  "environment_effect_unresolved",
                  "A previous environment effect still requires reconciliation",
                  409,
                );
              if ((environment?.data.currentArtifact ?? null) !== profile.expectedPreviousArtifact)
                throw new DomainError(
                  "environment_predecessor_changed",
                  "The expected prior healthy release no longer matches",
                  409,
                );
            }
            const previous =
              environment?.data.currentArtifact &&
              environment.data.currentReleaseId &&
              environment.data.currentProfile &&
              environment.data.currentEffectId
                ? {
                    artifactDigest: environment.data.currentArtifact,
                    releaseId: environment.data.currentReleaseId,
                    profile: environment.data.currentProfile,
                    effectId: environment.data.currentEffectId,
                  }
                : environment?.data.previous;
            const claim = {
              runId: Number(job.run_id),
              runAttempt: Number(job.run_attempt),
              manifestDigest: current.data.intent.manifestDigest,
              artifactDigest: input.artifactDigest,
              environmentId,
              environmentGeneration: (environment?.data.generation ?? 0) + 1,
              authorityExpiresAt: current.data.intent.deadline,
            };
            await tx.put("deployment-claim", environmentIdentity(current.id, "claim"), claim);
            await tx.put(
              "deployment-environment",
              environmentId,
              {
                effectId: current.id,
                generation: claim.environmentGeneration,
                ...(previous ? { previous } : {}),
                ...(environment?.data.currentArtifact
                  ? { currentArtifact: environment.data.currentArtifact }
                  : {}),
              },
              environment?.version ?? 0,
            );
            await tx.put(
              "effect",
              current.id,
              {
                ...current.data,
                status: "waiting",
                phase: "claimed",
                providerRunId: claim.runId,
                providerRunAttempt: claim.runAttempt,
              },
              current.version,
            );
            return {
              status: "claimed" as const,
              effectId: current.id,
              artifactDigest: input.artifactDigest,
              environment: profile.environment,
              environmentGeneration: claim.environmentGeneration,
              authorityExpiresAt: claim.authorityExpiresAt,
            };
          },
        );
      },
    });
    const receiptBody = z.strictObject({
      effectId: z.uuid(),
      manifestDigest: z.string(),
      artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
      runId: z.int().positive(),
      runAttempt: z.int().positive(),
      environmentGeneration: z.int().positive(),
      providerOperationId: z.string().min(1).max(1024),
      observedCodeDigest: z.string().regex(/^[a-f0-9]{64}$/),
      healthy: z.boolean(),
      healthStatus: z.int().min(100).max(599).nullable(),
      healthFailure: healthFailureSchema.nullable().default(null),
      healthArtifactDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
      accountId: z.string().regex(/^\d{12}$/),
      region: z.literal("eu-west-1"),
      stackId: z.string().min(1).max(2048),
      lambdaVersion: z.string().min(1).max(100),
    });
    router.add({
      method: "post",
      path: "/integrations/github/deployment-receipts/:organizationId",
      summary:
        "Accept exact authenticated provider observations while preserving unresolved environment effects",
      auth: "public",
      body: receiptBody,
      response: z.strictObject({ status: z.literal("accepted"), effectId: z.uuid() }),
      handler: async (req) => {
        const org = z.uuid().parse(req.params.organizationId),
          job = await this.identity.verify(req.request),
          effect = await this.store.read(org, (tx) =>
            tx.require<Effect>("effect", req.body.effectId),
          );
        if (!effect.data.workflow)
          throw new DomainError(
            "deployment_profile_missing",
            "The deployment has no pinned workflow",
            403,
          );
        this.verifyJob(job, effect.data.intent.repository, effect.data.workflow);
        if (
          Number(job.run_id) !== req.body.runId ||
          Number(job.run_attempt) !== req.body.runAttempt
        )
          throw new DomainError(
            "provider_receipt_identity_mismatch",
            "The receipt must come from its exact signed workflow run and attempt",
            403,
          );
        return this.store.command(
          {
            organizationId: org,
            actorId: `github:${job.run_id}:${job.run_attempt}`,
            operation: "deployment-receipt",
            operationId: req.operationId,
            request: req.body,
          },
          async (tx) => {
            const claim = await tx.require<DeploymentClaim>(
                "deployment-claim",
                environmentIdentity(req.body.effectId, "claim"),
              ),
              environment = await tx.require<EnvironmentState>(
                "deployment-environment",
                claim.data.environmentId,
              );
            if (
              claim.data.runId !== req.body.runId ||
              claim.data.runAttempt !== req.body.runAttempt ||
              claim.data.manifestDigest !== req.body.manifestDigest ||
              claim.data.artifactDigest !== req.body.artifactDigest ||
              req.body.observedCodeDigest !== req.body.artifactDigest ||
              claim.data.environmentGeneration !== req.body.environmentGeneration ||
              environment.data.effectId !== req.body.effectId ||
              environment.data.generation !== req.body.environmentGeneration
            )
              throw new DomainError(
                "deployment_receipt_mismatch",
                "The provider receipt does not match its exact claimed effect and environment generation",
                409,
              );
            if (
              req.body.accountId !== effect.data.workflow?.accountId ||
              !req.body.stackId.startsWith(
                `arn:aws:cloudformation:eu-west-1:${req.body.accountId}:stack/${effect.data.workflow?.stackName}/`,
              ) ||
              (req.body.healthStatus === null && req.body.healthFailure === null) ||
              (req.body.healthFailure !== null && req.body.healthArtifactDigest !== null) ||
              req.body.healthy !==
                (req.body.healthFailure === null &&
                  req.body.healthStatus === effect.data.workflow?.expectedStatus &&
                  req.body.healthArtifactDigest === req.body.artifactDigest)
            )
              throw new DomainError(
                "deployment_target_mismatch",
                "The provider observations do not match the pinned target and health policy",
                409,
              );
            if (
              await tx.get("deployment-receipt", environmentIdentity(req.body.effectId, "receipt"))
            )
              throw new DomainError(
                "deployment_receipt_conflict",
                "An accepted receipt is immutable; replay its original operation identity",
                409,
              );
            await tx.put(
              "deployment-receipt",
              environmentIdentity(req.body.effectId, "receipt"),
              req.body,
            );
            const releaseId =
              effect.data.recovery?.releaseId ??
              (
                await tx.require<{ releaseId: string }>(
                  "delivery-build",
                  effect.data.intent.deliveryId,
                )
              ).data.releaseId;
            if (req.body.healthy)
              await tx.put(
                "deployment-environment",
                environment.id,
                {
                  ...environment.data,
                  effectId: null,
                  currentArtifact: req.body.artifactDigest,
                  currentReleaseId: releaseId,
                  currentProfile: effect.data.workflow,
                  currentEffectId: effect.id,
                },
                environment.version,
              );
            return { status: "accepted" as const, effectId: req.body.effectId };
          },
        );
      },
    });
    router.add({
      method: "get",
      path: "/integrations/effects",
      summary: "Inspect durable GitHub and deployment effect obligations",
      response: z.strictObject({ items: z.array(envelope(effectViewSchema)) }),
      handler: (req) =>
        this.store.read(req.actor.organizationId, async (tx) => ({
          items: await tx.list<Effect>("effect"),
        })),
    });
    router.add({
      method: "post",
      path: "/integrations/github/routes",
      summary: "Bind signed GitHub issue events to one authorized project and repository",
      auth: "admin",
      body: z.strictObject({
        projectId: z.uuid(),
        repositoryId: z.uuid(),
        label: z.string().min(1).max(100),
        playbookVersionId: z.uuid().optional(),
      }),
      response: z.strictObject({ id: z.uuid(), repositoryProviderId: z.string() }),
      handler: async (req) => {
        const repository = await this.config.repository(
          req.actor.organizationId,
          req.body.repositoryId,
        );
        if (repository.projectId !== req.body.projectId)
          throw new DomainError(
            "repository_project_mismatch",
            "Select a repository registered to this project",
            409,
          );
        return this.store.command(req.command("github-route"), async (tx) => {
          const id = newId();
          await tx.put("issue-route", id, {
            ...req.body,
            repositoryProviderId: repository.providerId,
            actorId: req.actor.userId,
            active: true,
          } satisfies IssueRoute);
          return { id, repositoryProviderId: repository.providerId };
        });
      },
    });
    router.add({
      method: "post",
      path: "/integrations/github/webhooks/:organizationId",
      summary: "Verify, deduplicate and route a signed GitHub webhook before run admission",
      auth: "public",
      operationHeader: "X-GitHub-Delivery",
      verifyRaw: async (request, bytes) => {
        if (!this.config.webhookSecret)
          throw new DomainError(
            "webhook_not_configured",
            "GitHub webhook verification is not configured",
            503,
          );
        const supplied = request.headers.get("x-hub-signature-256") ?? "",
          expected = `sha256=${createHmac("sha256", this.config.webhookSecret).update(bytes).digest("hex")}`;
        if (
          supplied.length !== expected.length ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
        )
          throw new DomainError(
            "invalid_webhook_signature",
            "The provider delivery signature is invalid",
            401,
          );
      },
      body: z
        .object({
          action: z.string().optional(),
          repository: z.object({
            id: z.number().int(),
            owner: z.object({ id: z.number().int(), login: z.string() }),
            name: z.string(),
          }),
          issue: z
            .object({
              id: z.number().int(),
              number: z.number().int(),
              title: z.string().max(1000),
              body: z.string().nullable(),
              html_url: z.url(),
              labels: z.array(z.object({ name: z.string() })),
            })
            .optional(),
        })
        .passthrough(),
      response: z.strictObject({
        status: z.enum(["ignored", "admitted", "ambiguous", "pending"]),
        runId: z.string().optional(),
      }),
      handler: async (req) => {
        const org = z.uuid().parse(req.params.organizationId);
        const event = req.request.headers.get("x-github-event");
        const accepted = await this.store.command(
          {
            organizationId: org,
            actorId: "github-webhook",
            operation: "webhook",
            operationId: req.operationId,
            request: { event, payload: req.body },
          },
          async (tx) => {
            const issue = req.body.issue;
            if (
              event !== "issues" ||
              !issue ||
              !["opened", "labeled", "reopened"].includes(req.body.action ?? "")
            )
              return { status: "ignored" as const };
            const routes = (await tx.all<IssueRoute>("issue-route")).filter(
              (route) =>
                route.data.active &&
                route.data.repositoryProviderId === String(req.body.repository.id) &&
                issue.labels.some((label) => label.name === route.data.label),
            );
            if (routes.length !== 1)
              return { status: routes.length ? ("ambiguous" as const) : ("ignored" as const) };
            const route = routes[0].data;
            return {
              status: "pending" as const,
              route,
              issue: {
                id: String(issue.id),
                number: issue.number,
                title: issue.title,
                body: issue.body ?? "",
                url: issue.html_url,
              },
            };
          },
        );
        if (accepted.status !== "pending" || !("route" in accepted))
          return { status: accepted.status };
        const repository = await this.config.repository(org, accepted.route.repositoryId);
        if (
          repository.providerId !== String(req.body.repository.id) ||
          repository.ownerId !== String(req.body.repository.owner.id) ||
          repository.owner !== req.body.repository.owner.login ||
          repository.name !== req.body.repository.name
        )
          throw new DomainError(
            "repository_identity_changed",
            "Webhook repository identity requires revalidation",
            409,
          );
        const result = await this.config.startFromIssue(org, {
          projectId: accepted.route.projectId,
          repositoryId: accepted.route.repositoryId,
          issue: accepted.issue,
          actorId: accepted.route.actorId,
          deliveryKey: `github-issue:${repository.providerId}:${accepted.issue.id}`,
          ...(accepted.route.playbookVersionId
            ? { playbookVersionId: accepted.route.playbookVersionId }
            : {}),
        });
        return { status: result.status ?? ("pending" as const), runId: result.runId };
      },
    });
    router.add({
      method: "post",
      path: "/integrations/deployment-profiles",
      summary: "Create an immutable pinned staging or production workflow profile",
      auth: "admin",
      body: deploymentProfileSchema,
      response: z.strictObject({ id: z.uuid(), digest: z.string() }),
      handler: async (req) => {
        await this.config.repository(req.actor.organizationId, req.body.repositoryId);
        return this.store.command(req.command("deployment-profile"), async (tx) => {
          const id = newId();
          await tx.put("deployment-profile", id, req.body);
          return { id, digest: digest(req.body) };
        });
      },
    });
  }
}
interface Release {
  deliveryId: string;
  repositoryProviderId: string;
  commit: string;
  artifactDigest: string;
  workflowRevision: string;
  artifactObject: { bucket: string; key: string; versionId: string };
  templateDigest: string;
}
interface DeploymentReceipt {
  runId: number;
  manifestDigest: string;
  artifactDigest: string;
  healthy: boolean;
}
interface DeploymentClaim {
  runId: number;
  runAttempt: number;
  manifestDigest: string;
  artifactDigest: string;
  environmentId: string;
  environmentGeneration: number;
  authorityExpiresAt: string;
}
interface EnvironmentState {
  effectId: string | null;
  generation: number;
  currentArtifact?: string;
  currentReleaseId?: string;
  currentProfile?: DeploymentProfile;
  currentEffectId?: string;
  previous?: {
    artifactDigest: string;
    releaseId: string;
    profile: DeploymentProfile;
    effectId: string;
  };
}
function environmentIdentity(repositoryProviderId: string, environment: string): string {
  const hex = digest({ repositoryProviderId, environment });
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
