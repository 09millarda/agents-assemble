import { type Actor, DomainError, type Message } from "@aa/platform/contracts";
import { newId } from "@aa/platform/crypto";
import { type ApiRouter, envelope } from "@aa/platform/http";
import type { ContextStore, Transaction } from "@aa/platform/store";
import { z } from "zod";
import {
  type ConsumerAuthority,
  type ProjectCheckpoint,
  projectCheckpointSchema,
  type ScopeConsumer,
  scopeConsumerSchema,
  scopeIdentity,
} from "./project-consumer.ts";

export const projectPolicySchema = z
  .object({
    trustedRunner: z.boolean(),
    maxInvocations: z.number().int().min(1).max(10000),
    allowedPlaybooks: z.array(z.string()).max(100),
    checkCommands: z
      .array(z.array(z.string().min(1).max(8192)).min(1).max(64))
      .max(32)
      .default([]),
    runtimeProfileId: z.string().uuid().optional(),
    environmentProfileId: z.string().uuid().optional(),
  })
  .strict();
export const projectSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(2000),
    status: z.enum(["active", "closing", "archived", "suspending", "suspended"]),
    policyEpoch: z.number().int().positive(),
    policyRevision: z.number().int().positive().default(1),
    policy: projectPolicySchema,
    cutoffs: z.record(z.string(), z.number().int()),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;
export const repositorySchema = z
  .object({
    projectId: z.string().uuid(),
    provider: z.literal("github"),
    providerId: z.string(),
    ownerId: z.string(),
    owner: z.string(),
    name: z.string(),
    url: z.string().url(),
    defaultBranch: z.string(),
    baseline: z.string().regex(/^[a-f0-9]{40}$/),
    bindingRevision: z.number().int().positive(),
    status: z.enum(["active", "closing", "removed"]),
  })
  .strict();
export type Repository = z.infer<typeof repositorySchema>;
export interface RepositoryPort {
  resolve(
    owner: string,
    name: string,
  ): Promise<Omit<Repository, "projectId" | "bindingRevision" | "status">>;
  verifyCommit(repository: Repository, commit: string): Promise<boolean>;
}
export class GithubRepositories implements RepositoryPort {
  constructor(
    private token?: string,
    private apiBase = "https://api.github.com",
  ) {}
  private async get(path: string) {
    const response = await fetch(`${this.apiBase}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new DomainError(
        "repository_unavailable",
        "GitHub repository identity or authorized access could not be verified",
        409,
        "same_operation",
      );
    return response.json();
  }
  async resolve(owner: string, name: string) {
    const value = z
      .object({
        id: z.number().int(),
        owner: z.object({ id: z.number().int(), login: z.string() }),
        name: z.string(),
        clone_url: z.string().url(),
        default_branch: z.string(),
      })
      .parse(await this.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`));
    const commit = z
      .object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
      .parse(
        await this.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(value.default_branch)}`,
        ),
      );
    return {
      provider: "github" as const,
      providerId: String(value.id),
      ownerId: String(value.owner.id),
      owner: value.owner.login,
      name: value.name,
      url: value.clone_url,
      defaultBranch: value.default_branch,
      baseline: commit.sha,
    };
  }
  async verifyCommit(repository: Repository, commit: string) {
    const identity = z
      .object({
        id: z.number(),
        owner: z.object({ id: z.number(), login: z.string() }),
        name: z.string(),
      })
      .parse(
        await this.get(
          `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
        ),
      );
    if (
      String(identity.id) !== repository.providerId ||
      String(identity.owner.id) !== repository.ownerId ||
      identity.owner.login !== repository.owner ||
      identity.name !== repository.name
    )
      throw new DomainError(
        "repository_identity_changed",
        "Repository or owner identity changed; revalidate the registration before new authority",
        409,
      );

    const value = z
      .object({ sha: z.string() })
      .parse(
        await this.get(
          `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${commit}`,
        ),
      );
    return value.sha === commit;
  }
}
export const permitSchema = z
  .object({
    runId: z.string().uuid(),
    projectId: z.string().uuid(),
    repositoryId: z.string().uuid(),
    bindingRevision: z.number().int(),
    policyEpoch: z.number().int(),
    scopeDigest: z.string(),
    expiresAt: z.string().datetime(),
    verdict: z.enum(["pending", "admitted", "rejected", "expired_unused"]),
  })
  .strict();
export type Permit = z.infer<typeof permitSchema>;
type ConsumerRegistration = { consumer: ScopeConsumer; generation: number; incarnation: string };
const consumerMode = (project: Project): ProjectCheckpoint["status"] =>
  ["suspending", "suspended"].includes(project.status)
    ? "suspended"
    : ["closing", "archived"].includes(project.status)
      ? "archived"
      : "active";
export class Projects {
  constructor(
    readonly store: ContextStore,
    readonly repositories: RepositoryPort,
  ) {}
  async enrollConsumer(organizationId: string, consumer: ScopeConsumer, incarnation: string) {
    scopeConsumerSchema.parse(consumer);
    z.uuid().parse(incarnation);
    return this.store.command(
      {
        organizationId,
        actorId: "worker",
        operation: "enroll-consumer",
        operationId: `${consumer}:${incarnation}`,
        request: { consumer, incarnation },
      },
      async (tx) => {
        const id = scopeIdentity({ consumer }),
          prior = await tx.get<ConsumerRegistration>("scope-consumer", id);
        if (prior?.data.incarnation === incarnation) return prior;
        const registration = await tx.put(
          "scope-consumer",
          id,
          { consumer, incarnation, generation: (prior?.data.generation ?? 0) + 1 },
          prior?.version ?? 0,
        );
        for (const row of await tx.all<Project>("project")) {
          const cutoffs = { ...row.data.cutoffs };
          delete cutoffs[consumer];
          await tx.put(
            "project",
            row.id,
            {
              ...row.data,
              cutoffs,
              status: row.data.status === "suspended" ? "suspending" : row.data.status,
            },
            row.version,
          );
        }
        return registration;
      },
    );
  }
  consumerCheckpoints(organizationId: string, consumer: ScopeConsumer, incarnation: string) {
    return this.store.read(organizationId, async (tx) => {
      const enrollment = await tx.require<ConsumerRegistration>(
        "scope-consumer",
        scopeIdentity({ consumer }),
      );
      if (enrollment.data.incarnation !== incarnation)
        throw new DomainError(
          "consumer_superseded",
          "A newer worker owns this logical consumer group",
          409,
        );
      return (await tx.all<Project>("project")).map((row) => ({
        projectId: row.id,
        consumer,
        generation: enrollment.data.generation,
        incarnation,
        epoch: row.data.policyEpoch,
        status: consumerMode(row.data),
      }));
    });
  }
  acknowledgeCheckpoint(
    organizationId: string,
    value: { checkpoint: ProjectCheckpoint; receiptId: string },
  ) {
    const checkpoint = projectCheckpointSchema.parse(value.checkpoint);
    return this.store.command(
      {
        organizationId,
        actorId: checkpoint.consumer,
        operation: "ack-consumer-checkpoint",
        operationId: value.receiptId,
        request: value,
      },
      async (tx) => {
        const enrollment = await tx.require<ConsumerRegistration>(
            "scope-consumer",
            scopeIdentity({ consumer: checkpoint.consumer }),
          ),
          project = await tx.require<Project>("project", checkpoint.projectId);
        if (
          enrollment.data.incarnation !== checkpoint.incarnation ||
          enrollment.data.generation !== checkpoint.generation ||
          project.data.policyEpoch !== checkpoint.epoch ||
          consumerMode(project.data) !== checkpoint.status
        )
          throw new DomainError(
            "consumer_checkpoint_changed",
            "Enrollment or project policy changed before the checkpoint acknowledgment",
            409,
          );
        const id = scopeIdentity({ consumer: checkpoint.consumer, project: checkpoint.projectId }),
          prior = await tx.get("scope-consumer-checkpoint", id);
        const receipt = await tx.put("scope-consumer-checkpoint", id, value, prior?.version ?? 0);
        const cutoffs = { ...project.data.cutoffs, [checkpoint.consumer]: checkpoint.epoch };
        let settled = true;
        for (const consumer of scopeConsumerSchema.options) {
          const registration = await tx.get<ConsumerRegistration>(
            "scope-consumer",
            scopeIdentity({ consumer }),
          );
          if (!registration) {
            settled = false;
            continue;
          }
          const acknowledged = await tx.get<{ checkpoint: ProjectCheckpoint }>(
            "scope-consumer-checkpoint",
            scopeIdentity({ consumer, project: project.id }),
          );
          if (
            !acknowledged ||
            acknowledged.data.checkpoint.generation !== registration.data.generation ||
            acknowledged.data.checkpoint.incarnation !== registration.data.incarnation ||
            acknowledged.data.checkpoint.epoch !== project.data.policyEpoch
          )
            settled = false;
        }
        await tx.put(
          "project",
          project.id,
          {
            ...project.data,
            cutoffs,
            status:
              project.data.status === "suspending" && settled ? "suspended" : project.data.status,
          },
          project.version,
        );
        return receipt;
      },
    );
  }
  private async consumerAuthority(
    tx: Transaction,
    projectId: string,
    consumer: ScopeConsumer,
  ): Promise<ConsumerAuthority> {
    const project = await tx.require<Project>("project", projectId),
      registration = await tx.get<ConsumerRegistration>(
        "scope-consumer",
        scopeIdentity({ consumer }),
      ),
      ack = await tx.get<{ checkpoint: ProjectCheckpoint }>(
        "scope-consumer-checkpoint",
        scopeIdentity({ consumer, project: projectId }),
      );
    const checkpoint = ack?.data.checkpoint;
    if (
      !registration ||
      !checkpoint ||
      checkpoint.generation !== registration.data.generation ||
      checkpoint.incarnation !== registration.data.incarnation ||
      checkpoint.epoch !== project.data.policyEpoch ||
      checkpoint.status !== consumerMode(project.data) ||
      checkpoint.status === "suspended"
    )
      throw new DomainError(
        "consumer_checkpoint_required",
        "The current consumer generation must install and acknowledge this project checkpoint before scope handoff",
        409,
        "same_operation",
      );
    return { ...checkpoint, expiresAt: new Date((await tx.now()).getTime() + 5000).toISOString() };
  }
  authorizeConsumer(organizationId: string, projectId: string, consumer: ScopeConsumer) {
    return this.store.read(organizationId, (tx) => this.consumerAuthority(tx, projectId, consumer));
  }
  consumerStatus(organizationId: string, projectId: string) {
    return this.store.read(organizationId, async (tx) => {
      await tx.require("project", projectId);
      const items = [];
      for (const consumer of scopeConsumerSchema.options) {
        const enrollment = await tx.get<ConsumerRegistration>(
            "scope-consumer",
            scopeIdentity({ consumer }),
          ),
          checkpoint = await tx.get<{ checkpoint: ProjectCheckpoint; receiptId: string }>(
            "scope-consumer-checkpoint",
            scopeIdentity({ consumer, project: projectId }),
          );
        items.push({
          consumer,
          enrollment: enrollment?.data ?? null,
          checkpoint: checkpoint?.data ?? null,
        });
      }
      return { items };
    });
  }
  async get(organizationId: string, id: string) {
    return this.store.read(organizationId, (tx) => tx.require<Project>("project", id));
  }
  async repository(organizationId: string, id: string) {
    return this.store.read(organizationId, (tx) => tx.require<Repository>("repository", id));
  }
  async permit(
    actor: Actor,
    runId: string,
    projectId: string,
    repositoryId: string,
    scopeDigest: string,
    expected: { policyRevision: number; policyEpoch: number; bindingRevision: number },
  ) {
    return this.store.command(
      {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        operation: "permit",
        operationId: runId,
        request: { runId, projectId, repositoryId, scopeDigest, expected },
      },
      async (tx) => {
        const project = await tx.require<Project>("project", projectId),
          repository = await tx.require<Repository>("repository", repositoryId);
        if (
          project.data.status !== "active" ||
          repository.data.status !== "active" ||
          repository.data.projectId !== projectId
        )
          throw new DomainError("scope_closed", "The project or repository is closed to new work");
        if (
          project.data.policyRevision !== expected.policyRevision ||
          project.data.policyEpoch !== expected.policyEpoch ||
          repository.data.bindingRevision !== expected.bindingRevision
        )
          throw new DomainError(
            "policy_changed",
            "Scope changed after immutable candidate resolution",
          );
        try {
          for (const consumer of scopeConsumerSchema.options)
            await this.consumerAuthority(tx, projectId, consumer);
        } catch (error) {
          if (error instanceof DomainError && error.code === "consumer_checkpoint_required")
            throw new Error("consumer_checkpoint_pending");
          throw error;
        }
        const permit = await tx.put("permit", runId, {
          runId,
          projectId,
          repositoryId,
          bindingRevision: repository.data.bindingRevision,
          policyEpoch: project.data.policyEpoch,
          scopeDigest,
          expiresAt: new Date((await tx.now()).getTime() + 60000).toISOString(),
          verdict: "pending",
        } satisfies Permit);
        await tx.emit("projects.permit_issued", permit, permit.data);
        return permit;
      },
    );
  }
  async accept(message: Message) {
    return this.store.consume(message, async (tx) => {
      if (message.type === "execution.admission_verdict") {
        const payload = z
          .object({
            runId: z.string(),
            verdict: z.enum(["admitted", "rejected", "expired_unused"]),
          })
          .passthrough()
          .parse(message.payload);
        const permit = await tx.get<Permit>("permit", payload.runId);
        if (permit && permit.data.verdict === "pending")
          await tx.put(
            "permit",
            permit.id,
            { ...permit.data, verdict: payload.verdict },
            permit.version,
          );
      }
      for (const project of await tx.all<Project>("project"))
        if (project.data.status === "closing") {
          const pending = (await tx.all<Permit>("permit")).some(
            (row) => row.data.projectId === project.id && row.data.verdict === "pending",
          );
          if (!pending)
            await tx.put(
              "project",
              project.id,
              { ...project.data, status: "archived" },
              project.version,
            );
        }
      return { accepted: true };
    });
  }
  register(router: ApiRouter) {
    router.add({
      method: "get",
      path: "/projects",
      summary: "List projects and their lifecycle cutoffs",
      response: z.object({ items: z.array(envelope(projectSchema)) }),
      handler: (req) =>
        this.store.read(req.actor.organizationId, async (tx) => ({
          items: await tx.all<Project>("project"),
        })),
    });
    router.add({
      method: "get",
      path: "/projects/:id/consumers",
      summary: "Inspect current consumer generations and installed project checkpoints",
      response: z.strictObject({
        items: z.array(
          z.strictObject({
            consumer: scopeConsumerSchema,
            enrollment: z
              .strictObject({
                consumer: scopeConsumerSchema,
                generation: z.int().positive(),
                incarnation: z.uuid(),
              })
              .nullable(),
            checkpoint: z
              .strictObject({ checkpoint: projectCheckpointSchema, receiptId: z.uuid() })
              .nullable(),
          }),
        ),
      }),
      handler: (req) => this.consumerStatus(req.actor.organizationId, req.params.id),
    });
    router.add({
      method: "get",
      path: "/projects/:id",
      summary: "Read a project in the current organization",
      response: envelope(projectSchema),
      handler: (req) => this.get(req.actor.organizationId, req.params.id),
    });
    router.add({
      method: "post",
      path: "/projects",
      summary: "Create an organization project",
      auth: "admin",
      body: z
        .object({ name: z.string().min(1).max(100), description: z.string().max(2000).default("") })
        .strict(),
      response: envelope(projectSchema),
      handler: (req) =>
        this.store.command(req.command("create-project"), async (tx) => {
          const project = await tx.put("project", newId(), {
            ...req.body,
            status: "active",
            policyEpoch: 1,
            policyRevision: 1,
            policy: {
              trustedRunner: false,
              maxInvocations: 100,
              allowedPlaybooks: [],
              checkCommands: [],
            },
            cutoffs: {},
          } satisfies Project);
          await tx.emit("projects.policy_changed", project, {
            projectId: project.id,
            epoch: 1,
            status: "active",
          });
          return project;
        }),
    });
    router.add({
      method: "post",
      path: "/projects/:id/policy",
      summary: "Create an immutable project policy revision",
      auth: "admin",
      body: z
        .object({ expectedVersion: z.number().int().positive(), policy: projectPolicySchema })
        .strict(),
      response: envelope(projectSchema),
      handler: (req) =>
        this.store.command(
          req.command("project-policy", { id: req.params.id, ...req.body }),
          async (tx) => {
            const row = await tx.require<Project>("project", req.params.id);
            return tx.put(
              "project",
              row.id,
              { ...row.data, policy: req.body.policy, policyRevision: row.data.policyRevision + 1 },
              req.body.expectedVersion,
            );
          },
        ),
    });
    for (const action of ["archive", "suspend", "resume"] as const)
      router.add({
        method: "post",
        path: `/projects/:id/${action}`,
        summary: `${action} project scope with explicit consumer cutoffs`,
        auth: "admin",
        body: z
          .object({
            expectedVersion: z.number().int().positive(),
            reason: z.string().min(1).max(1000),
          })
          .strict(),
        response: envelope(projectSchema),
        handler: (req) =>
          this.store.command(
            req.command(`project-${action}`, { id: req.params.id, ...req.body }),
            async (tx) => {
              const project = await tx.require<Project>("project", req.params.id);
              const status =
                action === "archive" ? "closing" : action === "suspend" ? "suspending" : "active";
              const updated = await tx.put(
                "project",
                project.id,
                {
                  ...project.data,
                  status,
                  policyEpoch: project.data.policyEpoch + (action === "archive" ? 0 : 1),
                },
                req.body.expectedVersion,
              );
              await tx.emit("projects.policy_changed", updated, {
                projectId: project.id,
                epoch: updated.data.policyEpoch,
                status,
                reason: req.body.reason,
              });
              return updated;
            },
          ),
      });
    router.add({
      method: "get",
      path: "/projects/:id/repositories",
      summary: "List verified repository binding revisions",
      response: z.object({ items: z.array(envelope(repositorySchema)) }),
      handler: async (req) => {
        await this.get(req.actor.organizationId, req.params.id);
        return this.store.read(req.actor.organizationId, async (tx) => ({
          items: (await tx.all<Repository>("repository")).filter(
            (row) => row.data.projectId === req.params.id,
          ),
        }));
      },
    });
    router.add({
      method: "post",
      path: "/projects/:id/repositories",
      summary: "Register a verified GitHub repository identity",
      auth: "admin",
      body: z
        .object({
          owner: z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
          name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
        })
        .strict(),
      response: envelope(repositorySchema),
      handler: async (req) => {
        await this.get(req.actor.organizationId, req.params.id);
        const verified = await this.repositories.resolve(req.body.owner, req.body.name);
        return this.store.command(
          req.command("register-repository", { projectId: req.params.id, ...req.body }),
          async (tx) => {
            const project = await tx.require<Project>("project", req.params.id);
            if (project.data.status !== "active")
              throw new DomainError("scope_closed", "Project is closed to registration");
            const duplicate = (await tx.all<Repository>("repository")).find(
              (row) =>
                row.data.projectId === project.id &&
                row.data.providerId === verified.providerId &&
                row.data.status === "active",
            );
            if (duplicate) return duplicate;
            return tx.put("repository", newId(), {
              ...verified,
              projectId: project.id,
              bindingRevision: 1,
              status: "active",
            } satisfies Repository);
          },
        );
      },
    });
    router.add({
      method: "post",
      path: "/projects/:id/repositories/:repositoryId/revalidate",
      summary: "Revalidate upstream identity before changing a repository binding",
      auth: "admin",
      body: z
        .object({
          expectedVersion: z.number().int().positive(),
          owner: z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
          name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
        })
        .strict(),
      response: envelope(repositorySchema),
      handler: async (req) => {
        const prior = await this.repository(req.actor.organizationId, req.params.repositoryId);
        if (prior.data.projectId !== req.params.id)
          throw new DomainError("not_found", "Registration unavailable", 404);
        const verified = await this.repositories.resolve(req.body.owner, req.body.name);
        return this.store.command(
          req.command("revalidate-repository", { id: prior.id, ...req.body }),
          async (tx) => {
            const current = await tx.require<Repository>("repository", prior.id);
            if (current.data.providerId !== verified.providerId)
              throw new DomainError(
                "repository_replaced",
                "A replacement upstream repository requires a new registration",
              );
            return tx.put(
              "repository",
              prior.id,
              { ...current.data, ...verified, bindingRevision: current.data.bindingRevision + 1 },
              req.body.expectedVersion,
            );
          },
        );
      },
    });
  }
}
