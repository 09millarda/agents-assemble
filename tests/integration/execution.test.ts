import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { type Definition, digest } from "@aa/catalog/definition";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import { GithubRepositories } from "../../apps/api/src/projects.ts";
import { Worker } from "../../apps/worker/src/worker.ts";
import { isolatedDatabase } from "../fixtures/database.ts";

const database = isolatedDatabase(),
  databaseUrl = database.url;
const sha = "a".repeat(40),
  id = randomUUID(),
  email = `execution-${id}@example.test`;
const github = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify(
      req.url?.includes("/commits/")
        ? { sha }
        : {
            id: 123,
            owner: { id: 1, login: "fixture" },
            name: "repo",
            clone_url: "https://github.com/fixture/repo.git",
            default_branch: "main",
          },
    ),
  );
});
let app: Application,
  worker: Worker,
  token: string,
  org: string,
  projectId: string,
  repositoryId: string,
  versionId: string;
const call = async (path: string, body?: unknown, key = randomUUID()) => {
  const response = await app.router.app.request(`http://localhost/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Organization-Id": org,
      "Idempotency-Key": key,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  return { status: response.status, data };
};
async function settle() {
  for (let i = 0; i < 5; i++) await worker.once();
}
const config = () => ({
  databaseUrl,
  sessionKey: "test-session-key-at-least-32-characters",
  deploymentId: "test",
  repositories: new GithubRepositories(
    undefined,
    `http://127.0.0.1:${(github.address() as { port: number }).port}`,
  ),
});
beforeAll(async () => {
  await database.create();
  await new Promise<void>((resolve) => github.listen(0, "127.0.0.1", resolve));
  app = await createApplication(config());
  worker = new Worker(app);
  org = (
    await app.access.bootstrap({
      email,
      name: "Owner",
      password: "a-long-test-password",
      organizationName: "Execution tests",
    })
  ).organizationId;
  token = (await call("/auth/login", { email, password: "a-long-test-password" })).data.token;
  projectId = (await call("/projects", { name: "Delivery" })).data.id;
  repositoryId = (
    await call(`/projects/${projectId}/repositories`, { owner: "fixture", name: "repo" })
  ).data.id;
  const action = {
    id: "confirm",
    version: "1.0.0",
    kind: "human" as const,
    executor: "service" as const,
    adapter: "confirm",
    adapterVersion: "1.0.0",
    inputs: {},
    outputs: {
      type: "object",
      properties: { approved: { type: "boolean" } },
      required: ["approved"],
      additionalProperties: false,
    },
    effect: "read" as const,
    permissions: [],
    capabilities: [],
    retry: { maxAttempts: 1, safeErrorClasses: [] },
    timeoutSeconds: 60,
    cancellation: "supported" as const,
  };
  const definition: Definition = {
    formatVersion: "agents-assemble.playbook/1",
    package: { id: `test/${id}`, version: "1.0.0" },
    inputs: {},
    outputs: {},
    dependencies: { confirm: { ...action, digest: digest(action) } },
    runtimeSlots: {},
    permissions: [],
    policy: {
      maxInvocations: 10,
      maxConcurrency: 2,
      maxExpressionDepth: 32,
      maxExpressionNodes: 100,
      referencedSpecChange: "pause_and_replan",
    },
    body: {
      id: "journey",
      type: "sequence",
      children: [
        {
          id: "approval",
          type: "call",
          action: "confirm",
          with: { literal: { question: "Proceed?" } },
        },
        { id: "end", type: "end", result: { ref: { source: "approval", pointer: "" } } },
      ],
    },
  };
  const draft = await call("/catalog/playbooks", { title: "Approval", definition });
  expect(draft.status).toBe(200);
  const candidate = await call(`/collaboration/catalog/${draft.data.id}/candidates`, {
    epoch: draft.data.data.epoch,
    expectedSequence: 0,
  });
  expect(candidate.status).toBe(200);
  const version = await call(`/catalog/playbooks/${draft.data.id}/publish`, {
    candidateId: candidate.data.id,
    expectedHead: 0,
  });
  expect(version.status).toBe(200);
  versionId = version.data.id;
  await settle();
});
afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => github.close(() => resolve()));
  await database.destroy();
});
test("a candidate becomes an immutable admitted run, exact human response resumes after restart", async () => {
  const operationId = randomUUID();
  const start = {
    projectId,
    repositoryId,
    versionId,
    sourceCommit: sha,
    inputs: {},
    runtimeBindings: {},
  };
  const created = await call("/runs", start, operationId);
  expect(created.status).toBe(200);
  expect(created.data.data.status).toBe("candidate");
  const duplicate = await call("/runs", start, operationId);
  expect(duplicate.data.id).toBe(created.data.id);
  await settle();
  const waiting = await call(`/runs/${created.data.id}`);
  expect(waiting.data.data.status).toBe("waiting");
  expect(waiting.data.data.admissionVerdict).toBe("admitted");
  const request = (await call("/requests")).data.items.find(
    (item: { data: { runId: string } }) => item.data.runId === created.data.id,
  );
  expect(request.data.status).toBe("pending");
  expect(request.data.authorizationPolicy).toEqual({
    kind: "current-organization-membership",
    minimumRole: "member",
  });
  expect(request.data.expiryPolicy).toEqual({ action: "suspend" });
  const response = {
    expectedVersion: request.version,
    manifestDigest: request.data.manifestDigest,
    response: { approved: true },
    reason: "Reviewed exact request",
  };
  expect(
    (await call(`/requests/${request.id}/respond`, { ...response, manifestDigest: "b".repeat(64) }))
      .status,
  ).toBe(409);
  expect((await call(`/requests/${request.id}/respond`, response)).status).toBe(200);
  await app.close();
  app = await createApplication(config());
  worker = new Worker(app);
  await settle();
  const completed = await call(`/runs/${created.data.id}`);
  expect(completed.data.data.status).toBe("completed");
  expect(completed.data.data.engine.output).toEqual({ approved: true });
  expect(completed.data.data.manifest.digest).toBe(waiting.data.data.manifest.digest);
});
test("cancellation supersedes human waits and never accepts a later reply", async () => {
  const created = await call("/runs", {
    projectId,
    repositoryId,
    versionId,
    sourceCommit: sha,
    inputs: {},
    runtimeBindings: {},
  });
  await settle();
  const waiting = (await call(`/runs/${created.data.id}`)).data;
  const request = (await call("/requests")).data.items.find(
    (item: { data: { runId: string } }) => item.data.runId === created.data.id,
  );
  expect(waiting.data.status).toBe("waiting");
  expect(
    (
      await call(`/runs/${created.data.id}/cancel`, {
        expectedVersion: waiting.version,
        reason: "Work is no longer required",
      })
    ).status,
  ).toBe(200);
  await settle();
  expect((await call(`/runs/${created.data.id}`)).data.data.status).toBe("canceled");
  const closed = (await call("/requests")).data.items.find(
    (item: { id: string }) => item.id === request.id,
  );
  expect(closed.data.status).toBe("superseded");
  expect(
    (
      await call(`/requests/${request.id}/respond`, {
        expectedVersion: closed.version,
        manifestDigest: request.data.manifestDigest,
        response: { approved: true },
        reason: "Late answer",
      })
    ).status,
  ).toBe(409);
  const candidate = await call("/runs", {
    projectId,
    repositoryId,
    versionId,
    sourceCommit: sha,
    inputs: {},
    runtimeBindings: {},
  });
  expect(
    (
      await call(`/runs/${candidate.data.id}/cancel`, {
        expectedVersion: candidate.data.version,
        reason: "Withdraw start",
      })
    ).data.data.status,
  ).toBe("canceled");
  await settle();
  expect((await call(`/runs/${candidate.data.id}`)).data.data.manifest).toBeUndefined();
});
test("suspension applies independent consumer cutoffs and archive waits for authoritative permits", async () => {
  const current = (await call(`/projects/${projectId}`)).data;
  const suspension = await call(`/projects/${projectId}/suspend`, {
    expectedVersion: current.version,
    reason: "Maintenance",
  });
  expect(suspension.data.data.status).toBe("suspending");
  await settle();
  const suspended = (await call(`/projects/${projectId}`)).data;
  expect(suspended.data.status).toBe("suspended");
  expect(suspended.data.cutoffs.execution).toBe(suspended.data.policyEpoch);
  expect(suspended.data.cutoffs.integrations).toBe(suspended.data.policyEpoch);
  const archived = await call(`/projects/${projectId}/archive`, {
    expectedVersion: suspended.version,
    reason: "Complete",
  });
  expect(archived.data.data.status).toBe("closing");
  await settle();
  expect((await call(`/projects/${projectId}`)).data.data.status).toBe("archived");
});
