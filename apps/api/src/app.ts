import { registerCatalog } from "@aa/catalog/routes";
import { CatalogService } from "@aa/catalog/service";
import { registerCollaboration } from "@aa/collaboration/routes";
import { CollaborationService } from "@aa/collaboration/service";
import { registerCommunity } from "@aa/community/routes";
import { CommunityService } from "@aa/community/service";
import { ContextName, DomainError } from "@aa/platform/contracts";
import { digest } from "@aa/platform/crypto";
import { ApiRouter } from "@aa/platform/http";
import { ContextStore } from "@aa/platform/store";
import { artifactRefSchema, checkpointRefSchema, scopeSchema } from "@aa/runner-protocol";
import { cors } from "hono/cors";
import { z } from "zod";
import { LocalAccess } from "./access.ts";
import { deliveryPorts } from "./delivery.ts";
import { Environments } from "./environments.ts";
import { Execution } from "./execution.ts";
import { Fleet } from "./fleet.ts";
import { HumanInteraction } from "./human.ts";
import { Integrations } from "./integrations.ts";
import { registerOperations } from "./operations.ts";
import { GithubRepositories, Projects, type RepositoryPort } from "./projects.ts";
import { type WorkosConfig, WorkosIdentity } from "./workos.ts";

export interface ApplicationConfig {
  databaseUrl: string;
  workos?: WorkosConfig;
  publicationPolicy?: "local" | "invitation";
  invitedPublisherOrganizations?: string[];
  sessionKey: string;
  deploymentId: string;
  githubToken?: string;
  githubWebhookSecret?: string;
  githubApiBase?: string;
  githubOidcAudience?: string;
  repositories?: RepositoryPort;
  stateDirectory?: string;
  hostname?: string;
  webOrigin?: string;
}
export async function createApplication(config: ApplicationConfig) {
  const stores = Object.fromEntries(
    ContextName.options.map((name) => [name, new ContextStore(name, config.databaseUrl)]),
  ) as Record<ContextName, ContextStore>;
  const access = new LocalAccess(
      stores.access,
      config.sessionKey,
      config.workos ? new WorkosIdentity(config.workos) : undefined,
    ),
    router = new ApiRouter(access);
  router.app.use(
    "/api/*",
    cors({
      origin: config.webOrigin ?? "http://localhost:5173",
      allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Organization-Id"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  const projects = new Projects(
    stores.projects,
    config.repositories ?? new GithubRepositories(config.githubToken),
  );
  const knowledge = new CollaborationService(stores.knowledge),
    catalogCollaboration = new CollaborationService(stores.catalog);
  const catalog = new CatalogService(stores.catalog, catalogCollaboration, config.deploymentId),
    environments = new Environments(stores.environments),
    human = new HumanInteraction(stores.human);
  if (
    config.workos ||
    config.publicationPolicy === "invitation" ||
    config.invitedPublisherOrganizations !== undefined
  )
    await access.configurePublicationPolicy(
      config.deploymentId,
      config.invitedPublisherOrganizations ?? [],
    );
  const community = new CommunityService(
    stores.community,
    catalog,
    {
      recheck: (actor, level) => access.recheck(actor, level).then(() => {}),
      isMember: (userId, org) => access.isMember(userId, org),
      invited: (actor) => access.publicationInvited(actor),
    },
    Boolean(config.workos) || config.publicationPolicy === "invitation",
  );
  const execution: Execution = new Execution(
    stores.execution,
    projects,
    access,
    {
      definition: async (org, id) => {
        const resolved = await catalog.resolveVersion(org, id);
        const components = new Set([
          resolved.digest,
          ...resolved.componentDigests,
          ...Object.values(resolved.definition.dependencies).map((action) => action.digest),
        ]);
        if (
          (await catalog.eligibility(org)).some((advisory) =>
            advisory.data.components.some((component) => components.has(component)),
          )
        )
          throw new DomainError(
            "package_quarantined",
            "A component advisory requires an explicit eligibility review",
          );
        return resolved;
      },
      runtime: async (org, id) => {
        const row = await catalog.getRuntimeProfile(org, id);
        if (!row.data.trustedRunner)
          throw new DomainError(
            "runtime_profile_unsupported",
            "Select a supported, explicitly trusted runtime profile",
          );
        return {
          profileId: row.id,
          revision: row.data.digest,
          model: row.data.model,
          effort: row.data.effort,
          sandbox: row.data.sandbox,
          trustedRunner: row.data.trustedRunner,
          codexVersion: row.data.codexVersion,
          capabilities: row.data.capabilities,
        };
      },
      environment: async (org, id) => {
        const row = await environments.get(org, id);
        if (
          row.data.resolverPolicy !== "local-file" ||
          row.data.rotationPolicy !== "refresh_per_attempt"
        )
          throw new DomainError(
            "unsupported_environment_policy",
            "Create a profile revision using local-file resolution refreshed for each new attempt",
            422,
          );
        return {
          profileId: row.id,
          revision: row.data.digest,
          variables: row.data.variables,
          secretBindings: row.data.secretBindings,
          resolverPolicy: row.data.resolverPolicy,
          rotationPolicy: row.data.rotationPolicy,
        };
      },
      artifact: async (org, id, revisionId, claimed) => {
        const row = await knowledge.getRevision(org, revisionId);
        if (row.data.documentId !== id || row.data.digest !== claimed)
          throw new DomainError(
            "artifact_mismatch",
            "Artifact revision is unavailable or its digest does not match",
            409,
          );
        return {
          documentId: id,
          submissionSequence: row.data.submissionSequence,
          epoch: row.data.epoch,
        };
      },
      checkpoint: async (org, value) => {
        const row = await fleet.getCheckpoint(org, value.id);
        if (
          row.data.repositoryId !== value.repositoryId ||
          row.data.commit !== value.commit ||
          row.data.digest !== value.digest
        )
          throw new DomainError(
            "checkpoint_mismatch",
            "Checkpoint does not match retained evidence",
          );
      },
      runners: (org) => fleet.eligibleRunners(org),
    },
    config.deploymentId,
  );
  const fleet: Fleet = new Fleet(
    stores.fleet,
    {
      deploymentId: config.deploymentId,
      stateDirectory: config.stateDirectory ?? ".local/control-plane",
      hostname: config.hostname,
      recheck: (actor) => access.recheck(actor, "admin"),
    },
    {
      reconcile: (principal, request) => execution.reconcileRunner(principal, request),
      authorizeLaunch: (principal, request) => execution.authorizeLaunch(principal, request),
      revoked: (principal) =>
        execution
          .revokeRunner(principal.organizationId, principal.runnerId, principal.operationId)
          .then(() => {}),
      artifactRead: async (principal, request) => {
        await execution.authorizeArtifactRead(principal, request.scope, request.reference);
        const revision = await knowledge.getRevision(
          principal.organizationId,
          request.reference.revisionId,
        );
        if (
          revision.data.documentId !== request.reference.id ||
          revision.data.digest !== request.reference.digest ||
          typeof revision.data.content !== "string"
        )
          throw new DomainError(
            "artifact_mismatch",
            "Artifact bytes do not match the exact immutable reference",
            409,
          );
        if (revision.data.content.length > 131072)
          throw new DomainError(
            "artifact_too_large",
            "Artifact exceeds the native read limit of 131072 characters",
            413,
          );
        return { reference: request.reference, content: revision.data.content };
      },
      artifact: async (principal, request) => {
        await execution.artifactAuthority(principal, request.scope, request.operationId, request);
        const meta = {
          organizationId: principal.organizationId,
          actorId: principal.runnerId,
          operation: "runner-artifact-create",
          operationId: request.operationId,
          request,
        };
        const draft = await knowledge.create(
          meta,
          `Action artifact ${request.scope.attemptId}`,
          "markdown",
          request.content,
        );
        const candidate = await knowledge.candidate(
          { ...meta, operation: "runner-artifact-candidate" },
          draft.id,
          { epoch: draft.data.epoch, expectedSequence: 0 },
        );
        const revision = await knowledge.submit(
          { ...meta, operation: "runner-artifact-submit" },
          draft.id,
          { candidateId: candidate.id, expectedHead: 0 },
        );
        return artifactRefSchema.parse({
          id: draft.id,
          revisionId: revision.id,
          digest: revision.data.digest,
          mediaType: request.mediaType,
        });
      },
      checkpoint: async (principal, request) => {
        const authority = await execution.artifactAuthority(
          principal,
          request.scope,
          request.operationId,
          request,
        );
        const run = await execution.get(principal.organizationId, request.scope.runId),
          manifest = run.data.manifest;
        const scope = scopeSchema.parse(request.checkpoint.scope);
        if (
          !manifest ||
          digest(scope) !== digest(request.scope) ||
          request.checkpoint.manifestDigest !== authority.commandPayloadDigest ||
          request.checkpoint.inputDigest !== request.scope.inputDigest ||
          request.checkpoint.invocationId !== request.scope.invocationId ||
          request.checkpoint.repositoryId !== manifest.repository.data.providerId ||
          request.checkpoint.repositoryUrl !== manifest.repository.data.url
        )
          throw new DomainError(
            "checkpoint_scope_mismatch",
            "Checkpoint does not bind this exact admitted invocation",
            403,
          );
        if (
          !(await projects.repositories.verifyCommit(
            manifest.repository.data,
            request.checkpoint.commit,
          ))
        )
          throw new DomainError(
            "checkpoint_unreachable",
            "Checkpoint is not reachable from the registered upstream",
            409,
            "reconcile",
          );
        const row = await fleet.recordCheckpoint(
          {
            organizationId: principal.organizationId,
            actorId: principal.runnerId,
            operation: "checkpoint",
            operationId: request.operationId,
            request,
          },
          {
            ...request.checkpoint,
            acceptedManifest: manifest.digest,
            writerCoverage: "incomplete",
          },
        );
        return checkpointRefSchema.parse({
          id: row.id,
          repositoryId: manifest.repository.data.providerId,
          commit: request.checkpoint.commit,
          digest: row.data.digest,
        });
      },
    },
  );
  await fleet.initialize();
  const integrations: Integrations = new Integrations(stores.integrations, {
    githubToken: config.githubToken,
    webhookSecret: config.githubWebhookSecret,
    apiBase: config.githubApiBase,
    oidcAudience: config.githubOidcAudience,
    authorizeConsumer: (org, projectId) =>
      projects.authorizeConsumer(org, projectId, "integrations"),
    ...deliveryPorts({
      fleet,
      access,
      projects,
      catalog,
      catalogCollaboration,
      knowledge,
      execution,
      reserveIssueStart: (org, input, sourceCommit) =>
        integrations.reserveIssueStart(org, input, sourceCommit),
    }),
  });
  integrations.register(router);
  registerOperations(router, stores);
  access.register(router);
  projects.register(router);
  environments.register(router);
  human.register(router);
  execution.register(router);
  fleet.register(router);
  registerCatalog(router, catalog);
  registerCommunity(router, community);
  registerCollaboration(router, { catalog: catalogCollaboration, knowledge });
  router.add({
    method: "get",
    path: "/health",
    summary: "Inspect service and database health",
    auth: "public",
    response: z
      .object({
        status: z.literal("ok"),
        database: z.literal("connected"),
        deploymentId: z.string(),
      })
      .strict(),
    handler: async () => {
      await stores.execution.health();
      return {
        status: "ok" as const,
        database: "connected" as const,
        deploymentId: config.deploymentId,
      };
    },
  });
  router.add({
    method: "get",
    path: "/operations",
    summary: "Inspect worker observations, durable delivery lag and poison messages",
    auth: "admin",
    response: z.object({
      contexts: z.array(
        z.object({
          context: z.string(),
          pending: z.number(),
          poison: z.number(),
          oldest_seconds: z.number(),
          worker: z
            .object({
              status: z.enum(["unknown", "recent", "stale"]),
              lastSeen: z.iso.datetime().nullable(),
              staleAt: z.iso.datetime().nullable(),
              observedAt: z.iso.datetime(),
            })
            .strict(),
        }),
      ),
    }),
    handler: async (req) => ({
      contexts: await Promise.all(
        Object.values(stores).map(async (store) => {
          const [health, worker] = await Promise.all([
            store.health(req.actor.organizationId),
            store.workerObservation(),
          ]);
          return { ...health, worker };
        }),
      ),
    }),
  });
  router.add({
    method: "get",
    path: "/openapi.json",
    summary: "Generated schema for all JSON HTTP routes",
    auth: "public",
    response: z.record(z.string(), z.unknown()),
    handler: () => router.document(),
  });
  return {
    router,
    stores,
    access,
    projects,
    catalog,
    catalogCollaboration,
    knowledge,
    environments,
    human,
    execution,
    fleet,
    community,
    integrations,
    async close() {
      await Promise.all(Object.values(stores).map((store) => store.close()));
    },
  };
}
export type Application = Awaited<ReturnType<typeof createApplication>>;
