import { randomUUID } from "node:crypto";
import { type Definition, digest } from "@aa/catalog/definition";
import { PUBLIC_ORGANIZATION } from "@aa/community/service";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import type { ScopeConsumer } from "../../apps/api/src/project-consumer.ts";
import { isolatedDatabase } from "../fixtures/database.ts";

const database = isolatedDatabase();

let app: Application,
  org: string,
  token: string,
  projectId: string,
  repositoryId: string,
  localVersion: string,
  importedVersion: string,
  releaseId: string,
  releaseVersion: number;
const commit = "a".repeat(40);
async function api(path: string, body?: unknown) {
  const response = await app.router.app.request(`http://local/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Organization-Id": org,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
async function messages(source: "knowledge" | "catalog" | "community", organizationId = org) {
  let after: string | undefined;
  for (;;) {
    const rows = await app.stores[source].messages(organizationId, { after, limit: 200 });
    for (const row of rows)
      if (source === "community") await app.catalog.acceptCommunityPolicy(org, row.message);
      else await app.execution.accept(row.message);
    if (rows.length < 200) break;
    after = rows.at(-1)?.message.id;
  }
}
async function document() {
  const draft = await api("/knowledge/documents", {
      title: "Exact initial specification",
      content: "original",
    }),
    path = `/collaboration/knowledge/${draft.id}`,
    candidate = await api(`${path}/candidates`, { epoch: draft.data.epoch, expectedSequence: 0 }),
    revision = await api(`${path}/submit`, { candidateId: candidate.id, expectedHead: 0 });
  return {
    draft,
    path,
    reference: {
      id: draft.id,
      revisionId: revision.id,
      digest: revision.data.digest,
      mediaType: "text/markdown",
    },
  };
}
beforeAll(async () => {
  await database.create();
  app = await createApplication({
    databaseUrl: database.url,
    sessionKey: "admission-cutoff-session-key-long-enough",
    deploymentId: "cutoff-test",
    repositories: {
      resolve: async (owner, name) => ({
        provider: "github",
        providerId: "scope-repo",
        ownerId: "scope-owner",
        owner,
        name,
        url: `https://github.com/${owner}/${name}.git`,
        defaultBranch: "main",
        baseline: commit,
      }),
      verifyCommit: async (_repo, candidate) => candidate === commit,
    },
  });
  const email = `cutoff-${randomUUID()}@example.test`;
  org = (
    await app.access.bootstrap({
      email,
      name: "Cutoff owner",
      password: "cutoff-password-long",
      organizationName: "Admission cutoff test",
    })
  ).organizationId;
  token = (await api("/auth/login", { email, password: "cutoff-password-long" })).token;
  projectId = (await api("/projects", { name: "Exact admission" })).id;
  repositoryId = (
    await api(`/projects/${projectId}/repositories`, { owner: "fixture", name: "cutoffs" })
  ).id;
  const incarnation = randomUUID();
  for (const consumer of ["execution", "integrations"] satisfies ScopeConsumer[]) {
    await app.projects.enrollConsumer(org, consumer, incarnation);
    for (const checkpoint of await app.projects.consumerCheckpoints(org, consumer, incarnation))
      await app.projects.acknowledgeCheckpoint(
        org,
        await app[consumer].installProjectCheckpoint(org, checkpoint),
      );
  }
  const action = {
    id: "confirm",
    version: "1.0.0",
    kind: "human" as const,
    executor: "service" as const,
    adapter: "confirm",
    adapterVersion: "1.0.0",
    inputs: {},
    outputs: {},
    effect: "read" as const,
    permissions: [],
    capabilities: [],
    retry: { maxAttempts: 1, safeErrorClasses: [] },
    timeoutSeconds: 60,
    cancellation: "supported" as const,
  };
  const definition: Definition = {
    formatVersion: "agents-assemble.playbook/1",
    package: { id: `cutoff/${randomUUID()}`, version: "1.0.0" },
    inputs: {},
    outputs: {},
    dependencies: { confirm: { ...action, digest: digest(action) } },
    runtimeSlots: {},
    permissions: [],
    policy: {
      maxInvocations: 2,
      maxConcurrency: 1,
      maxExpressionDepth: 32,
      maxExpressionNodes: 100,
      referencedSpecChange: "pause_and_replan",
    },
    body: {
      id: "confirm",
      type: "call",
      action: "confirm",
      with: { ref: { source: "input", pointer: "" } },
    },
  };
  const draft = await api("/catalog/playbooks", { title: "Cutoff definition", definition }),
    candidate = await api(`/collaboration/catalog/${draft.id}/candidates`, {
      epoch: draft.data.epoch,
      expectedSequence: 0,
    });
  localVersion = (
    await api(`/catalog/playbooks/${draft.id}/publish`, {
      candidateId: candidate.id,
      expectedHead: 0,
    })
  ).id;
  const publicCandidate = await api("/community/candidates", {
    versionId: localVersion,
    namespace: `cutoff-${randomUUID()}`,
    name: "Cutoff package",
    summary: "Exact reviewed test package",
    tags: [],
    authorName: "Fixture",
    organizationName: "Fixture",
    rights: [definition.package.id, action.id].map((componentId) => ({
      componentId,
      license: "Apache-2.0",
      redistribution: "permitted",
      noticeText: "Fixture component licensed under Apache-2.0",
    })),
  });
  const release = await api("/community/releases", {
    candidateId: publicCandidate.id,
    digest: publicCandidate.data.digest,
    expectedPolicyVersion: 0,
  });
  releaseId = release.id;
  releaseVersion = release.aggregateVersion;
  await api(`/community/releases/${releaseId}/import`, {});
  importedVersion = (await api("/catalog/versions")).items.find(
    (row: { data: { importedRoot?: string } }) => row.data.importedRoot === release.root,
  ).id;
});
afterAll(async () => {
  await app?.close();
  await database.destroy();
});
test("a snapshotted candidate cannot cross an already applied package quarantine cutoff", async () => {
  const spec = await document(),
    run = await api("/runs", {
      projectId,
      repositoryId,
      versionId: importedVersion,
      sourceCommit: commit,
      inputs: { spec: spec.reference },
      runtimeBindings: {},
    });
  await expect(app.execution.resolve(org, run.id)).rejects.toThrow("artifact_checkpoint_pending");
  expect((await api(`/runs/${run.id}`)).data.status).toBe("candidate");
  await api("/community/moderation", {
    targetId: releaseId,
    action: "quarantine",
    expectedVersion: releaseVersion,
    reason: "Reviewed security advisory",
    category: "security",
  });
  await messages("community", PUBLIC_ORGANIZATION);
  await messages("catalog");
  await messages("knowledge");
  await app.execution.resolve(org, run.id);
  const rejected = await api(`/runs/${run.id}`);
  expect(rejected.data.admissionVerdict).toBe("rejected");
  expect(rejected.data.manifest).toBeUndefined();
  expect(rejected.data.holds.package.reason).toContain("quarantine");
});
test("a later submitted document head cannot disappear while an exact candidate waits for admission", async () => {
  const spec = await document(),
    run = await api("/runs", {
      projectId,
      repositoryId,
      versionId: localVersion,
      sourceCommit: commit,
      inputs: { spec: spec.reference },
      runtimeBindings: {},
    });
  await expect(app.execution.resolve(org, run.id)).rejects.toThrow("artifact_checkpoint_pending");
  const replacement = await api(`${spec.path}/replace`, {
      epoch: spec.draft.data.epoch,
      expectedSequence: 0,
      content: "reviewed changed specification",
    }),
    candidate = await api(`${spec.path}/candidates`, {
      epoch: replacement.draft.data.epoch,
      expectedSequence: 1,
    }),
    changed = await api(`${spec.path}/submit`, { candidateId: candidate.id, expectedHead: 1 });
  await messages("knowledge");
  await app.execution.resolve(org, run.id);
  const rejected = await api(`/runs/${run.id}`);
  expect(rejected.data.admissionVerdict).toBe("rejected");
  expect(rejected.data.manifest).toBeUndefined();
  expect(rejected.data.proposals).toEqual([
    expect.objectContaining({
      documentId: spec.draft.id,
      revisionId: changed.id,
      digest: changed.data.digest,
      sequence: 2,
      status: "pending",
    }),
  ]);
});
test("retaining one observed proposal preserves the manifest while later adoption creates a freshly admitted successor", async () => {
  const spec = await document();
  await messages("knowledge");
  const run = await api("/runs", {
    projectId,
    repositoryId,
    versionId: localVersion,
    sourceCommit: commit,
    inputs: { spec: spec.reference },
    runtimeBindings: {},
  });
  await app.execution.resolve(org, run.id);
  await app.execution.tick(org);
  const original = await api(`/runs/${run.id}`);
  expect(original.data.status).toBe("waiting");
  async function submit(sequence: number) {
    const current = await api(spec.path),
      replacement = await api(`${spec.path}/replace`, {
        epoch: current.data.epoch,
        expectedSequence: sequence,
        content: `Reviewed successor specification ${sequence + 1}`,
      }),
      candidate = await api(`${spec.path}/candidates`, {
        epoch: replacement.draft.data.epoch,
        expectedSequence: sequence + 1,
      }),
      revision = await api(`${spec.path}/submit`, {
        candidateId: candidate.id,
        expectedHead: sequence + 1,
      });
    await messages("knowledge");
    return revision;
  }
  await submit(0);
  const proposed = await api(`/runs/${run.id}`),
    retained = await api(`/runs/${run.id}/retain`, {
      expectedVersion: proposed.version,
      proposalId: proposed.data.proposals[0].id,
      pinnedDigest: original.data.manifest.digest,
      reason: "Continue the exact approved specification",
    });
  expect(retained.data.manifest).toEqual(original.data.manifest);
  expect(retained.data.proposals[0].status).toBe("retained");
  expect(retained.data.holds).toEqual({});
  expect(retained.data.engine.nodes.confirm.requestId).not.toBe(
    original.data.engine.nodes.confirm.requestId,
  );
  const revision = await submit(1),
    changed = await api(`/runs/${run.id}`);
  expect(changed.data.proposals[1].status).toBe("pending");
  expect(changed.data.status).toBe("blocked");
  const successor = await api(`/runs/${run.id}/adopt`, {
    expectedVersion: changed.version,
    proposalId: changed.data.proposals[1].id,
    reason: "Adopt the separately reviewed immutable revision",
  });
  expect(successor.data.status).toBe("candidate");
  expect(successor.data.manifest).toBeUndefined();
  expect(successor.data.engine.nodes).toEqual({});
  expect(successor.data.predecessorId).toBe(run.id);
  expect(successor.data.request.inputs.spec.revisionId).toBe(revision.id);
  const predecessor = await api(`/runs/${run.id}`);
  expect(predecessor.data.status).toBe("superseded");
  expect(predecessor.data.manifest).toEqual(original.data.manifest);
  await app.execution.resolve(org, successor.id);
  const admitted = await api(`/runs/${successor.id}`);
  expect(admitted.data.status).toBe("admitted");
  expect(admitted.data.manifest.digest).not.toBe(original.data.manifest.digest);
  expect(admitted.data.manifest.inputs.spec.revisionId).toBe(revision.id);
});
