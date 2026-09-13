import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import {
  assertConsumerAuthority,
  type ScopeConsumer,
} from "../../apps/api/src/project-consumer.ts";
import { isolatedDatabase } from "../fixtures/database.ts";

const database = isolatedDatabase();

let app: Application, org: string, token: string, projectId: string;
const current = new Map<ScopeConsumer, string>();
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
async function install(consumer: ScopeConsumer) {
  const checkpoint = (
    await app.projects.consumerCheckpoints(org, consumer, current.get(consumer) ?? "")
  ).find((item) => item.projectId === projectId);
  if (!checkpoint) throw new Error("Missing authoritative project checkpoint");
  const receipt = await app[consumer].installProjectCheckpoint(org, checkpoint);
  await app.projects.acknowledgeCheckpoint(org, receipt);
  return receipt;
}
beforeAll(async () => {
  await database.create();
  app = await createApplication({
    databaseUrl: database.url,
    sessionKey: "consumer-barrier-test-session-key-long",
    deploymentId: "consumer-test",
  });
  const email = `consumer-${randomUUID()}@example.test`;
  org = (
    await app.access.bootstrap({
      email,
      name: "Consumer owner",
      password: "consumer-password-long",
      organizationName: "Consumer barriers",
    })
  ).organizationId;
  token = (await api("/auth/login", { email, password: "consumer-password-long" })).token;
  projectId = (await api("/projects", { name: "Scoped project" })).id;
});
afterAll(async () => {
  await app?.close();
  await database.destroy();
});
test("new and restarted consumer generations cannot inherit an old checkpoint acknowledgment", async () => {
  await expect(app.projects.authorizeConsumer(org, projectId, "execution")).rejects.toThrow(
    /checkpoint/,
  );
  const incarnation = randomUUID();
  for (const consumer of ["execution", "integrations"] as const) {
    current.set(consumer, incarnation);
    await app.projects.enrollConsumer(org, consumer, incarnation);
  }
  const first = await install("execution");
  await install("integrations");
  const authority = await app.projects.authorizeConsumer(org, projectId, "execution");
  expect(authority.generation).toBe(1);
  await app.stores.execution.read(org, (tx) => assertConsumerAuthority(tx, authority));
  const replacement = randomUUID();
  current.set("execution", replacement);
  await app.projects.enrollConsumer(org, "execution", replacement);
  await expect(app.projects.authorizeConsumer(org, projectId, "execution")).rejects.toThrow(
    /checkpoint/,
  );
  await app.projects.acknowledgeCheckpoint(org, first);
  await expect(app.projects.authorizeConsumer(org, projectId, "execution")).rejects.toThrow(
    /checkpoint/,
  );
  const second = await install("execution");
  expect(second.checkpoint.generation).toBe(2);
  await expect(
    app.stores.execution.read(org, (tx) => assertConsumerAuthority(tx, authority)),
  ).rejects.toThrow(/generation/);
  expect((await app.projects.authorizeConsumer(org, projectId, "execution")).incarnation).toBe(
    replacement,
  );
  const inspection = await api(`/projects/${projectId}/consumers`);
  expect(inspection.items).toHaveLength(2);
  expect(
    inspection.items.find((item: { consumer: string }) => item.consumer === "execution").checkpoint
      .checkpoint.generation,
  ).toBe(2);
});
test("suspension captures late enrollment and stays pending until every current generation installs it", async () => {
  const project = await api(`/projects/${projectId}`);
  const suspension = await api(`/projects/${projectId}/suspend`, {
    expectedVersion: project.version,
    reason: "Test current consumer cutoff",
  });
  expect(suspension.data.status).toBe("suspending");
  const incarnation = randomUUID();
  current.set("integrations", incarnation);
  await app.projects.enrollConsumer(org, "integrations", incarnation);
  await install("execution");
  expect((await api(`/projects/${projectId}`)).data.status).toBe("suspending");
  await expect(app.projects.authorizeConsumer(org, projectId, "integrations")).rejects.toThrow(
    /checkpoint/,
  );
  await install("integrations");
  expect((await api(`/projects/${projectId}`)).data.status).toBe("suspended");
  await expect(app.projects.authorizeConsumer(org, projectId, "execution")).rejects.toThrow(
    /checkpoint/,
  );
  const suspended = await api(`/projects/${projectId}`);
  await api(`/projects/${projectId}/resume`, {
    expectedVersion: suspended.version,
    reason: "Fresh authorized epoch",
  });
  await expect(app.projects.authorizeConsumer(org, projectId, "execution")).rejects.toThrow(
    /checkpoint/,
  );
  await install("execution");
  await install("integrations");
  expect((await app.projects.authorizeConsumer(org, projectId, "execution")).status).toBe("active");
});
