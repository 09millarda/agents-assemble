import type { CatalogService } from "@aa/catalog/service";
import { starterPlaybook } from "@aa/catalog/starters";
import type { CollaborationService } from "@aa/collaboration/service";
import { DomainError } from "@aa/platform/contracts";
import { artifactRefSchema, checkpointRefSchema } from "@aa/runner-protocol";
import type { LocalAccess } from "./access.ts";
import type { Execution } from "./execution.ts";
import type { Fleet } from "./fleet.ts";
import type { IntegrationConfig, Integrations } from "./integrations.ts";
import type { Projects } from "./projects.ts";

type DeliveryServices = {
  fleet: Fleet;
  access: LocalAccess;
  projects: Projects;
  catalog: CatalogService;
  catalogCollaboration: CollaborationService;
  knowledge: CollaborationService;
  execution: Execution;
  reserveIssueStart: Integrations["reserveIssueStart"];
};
export function deliveryPorts(
  services: DeliveryServices,
): Pick<IntegrationConfig, "repository" | "authorizeEffect" | "startFromIssue" | "createArtifact"> {
  const {
    fleet,
    access,
    projects,
    catalog,
    catalogCollaboration,
    knowledge,
    execution,
    reserveIssueStart,
  } = services;
  const createArtifact: IntegrationConfig["createArtifact"] = async (org, input) => {
    const meta = {
      organizationId: org,
      actorId: "integrations",
      operation: "integration-artifact",
      operationId: input.operationId,
      request: input,
    };
    const draft = await knowledge.create(
      meta,
      `Delivery evidence ${input.runId}`,
      "markdown",
      input.content,
    );
    const candidate = await knowledge.candidate(
      { ...meta, operation: "integration-artifact-candidate" },
      draft.id,
      { epoch: draft.data.epoch, expectedSequence: 0 },
    );
    const revision = await knowledge.submit(
      { ...meta, operation: "integration-artifact-submit" },
      draft.id,
      { candidateId: candidate.id, expectedHead: 0 },
    );
    return artifactRefSchema.parse({
      id: draft.id,
      revisionId: revision.id,
      digest: revision.data.digest,
      mediaType: input.mediaType,
    });
  };
  return {
    repository: async (org, id) => (await projects.repository(org, id)).data,
    authorizeEffect: (org, effect) => execution.authorizeEffect(org, effect),
    createArtifact,
    startFromIssue: async (org, input) => {
      const actor = await access.authorize(
        { userId: input.actorId, sessionId: "github-route" },
        org,
        "member",
      );
      const repository = await projects.repository(org, input.repositoryId);
      if (repository.data.projectId !== input.projectId || repository.data.status !== "active")
        throw new DomainError("scope_closed", "Issue route repository is unavailable");
      // Snapshot the first delivery intent before any cross-context work. Retries of
      // changed webhooks cannot silently rebind the same issue delivery lineage.
      const initial = await reserveIssueStart(org, input, repository.data.baseline);
      const pinned = initial.data.input,
        operationId = initial.id;
      let versionId = pinned.playbookVersionId;
      if (!versionId) {
        const starterKind = pinned.starterKind ?? "new-feature";
        const definition = starterPlaybook(starterKind),
          meta = {
            organizationId: org,
            actorId: input.actorId,
            operation: "install-starter",
            operationId: `${starterKind}:${definition.package.version}`,
            request: { definition },
          };
        const draft = await catalog.create(
          meta,
          starterKind === "bug-fix" ? "Bug fix" : "New feature",
          definition,
        );
        const candidate = await catalogCollaboration.candidate(
          { ...meta, operation: "install-starter-candidate" },
          draft.id,
          { epoch: draft.data.epoch, expectedSequence: 0 },
        );
        versionId = (
          await catalog.publish(
            { ...meta, operation: "install-starter-publish" },
            draft.id,
            candidate.id,
            0,
          )
        ).id;
      }
      const brief = await createArtifact(org, {
        operationId,
        runId: initial.id,
        mediaType: "text/markdown",
        content: `# ${pinned.issue.title}\n\n${pinned.issue.body}\n\nSource: ${pinned.issue.url}`,
      });
      const baseline = {
        repositoryId: repository.data.providerId,
        repositoryUrl: repository.data.url,
        commit: initial.data.sourceCommit,
        source: "registered-baseline",
      };
      const checkpoint = await fleet.recordCheckpoint(
        {
          organizationId: org,
          actorId: input.actorId,
          operation: "baseline-checkpoint",
          operationId,
          request: baseline,
        },
        { ...baseline, source: "registered-baseline" },
      );
      const reference = checkpointRefSchema.parse({
        id: checkpoint.id,
        repositoryId: baseline.repositoryId,
        commit: baseline.commit,
        digest: checkpoint.data.digest,
      });
      const run = await execution.start(
        actor,
        {
          projectId: pinned.projectId,
          repositoryId: pinned.repositoryId,
          versionId,
          sourceCommit: baseline.commit,
          inputs:
            pinned.starterKind === "bug-fix"
              ? {
                  report: brief,
                  baselineCheckpoint: reference,
                  priorFindings: null,
                  deliveryKey: pinned.deliveryKey,
                }
              : {
                  brief,
                  checkpoint: reference,
                  suppliedSpec: null,
                  deliveryKey: pinned.deliveryKey,
                },
          runtimeBindings: {},
          workItem: {
            provider: "github",
            repositoryId: baseline.repositoryId,
            issueNumber: pinned.issue.number,
            url: pinned.issue.url,
          },
        },
        operationId,
      );
      return {
        runId: run.id,
        status: run.data.admissionVerdict === "admitted" ? "admitted" : "pending",
      };
    },
  };
}
