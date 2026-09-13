import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextName } from "@aa/platform/contracts";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import { Worker } from "../../apps/worker/src/worker.ts";
import { isolatedDatabase } from "../fixtures/database.ts";

const database = isolatedDatabase();
const operationsSchema = z.object({
  contexts: z.array(
    z.object({
      context: ContextName,
      pending: z.number(),
      worker: z.object({
        status: z.enum(["unknown", "recent", "stale"]),
        lastSeen: z.iso.datetime().nullable(),
        staleAt: z.iso.datetime().nullable(),
        observedAt: z.iso.datetime(),
      }),
    }),
  ),
});
let app: Application, directory: string, token: string, organizationId: string;
const config = () => ({
  databaseUrl: database.url,
  stateDirectory: directory,
  deploymentId: "worker-health-fixture",
  sessionKey: "worker-health-fixture-session-key-at-least-32-characters",
});
async function request(path: string, body?: unknown) {
  return app.router.app.request(`http://localhost/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Organization-Id": organizationId,
      "Idempotency-Key": randomUUID(),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function operations() {
  const response = await request("/operations");
  expect(response.status).toBe(200);
  return operationsSchema.parse(await response.json()).contexts;
}
beforeAll(async () => {
  await database.create();
  directory = await mkdtemp(join(tmpdir(), "aa-worker-health-"));
  app = await createApplication(config());
  organizationId = (
    await app.access.bootstrap({
      email: "worker-operator@example.test",
      name: "Worker operator",
      password: "worker-health-fixture-password",
      organizationName: "Worker health",
    })
  ).organizationId;
  token = z.object({ token: z.string() }).parse(
    await (
      await request("/auth/login", {
        email: "worker-operator@example.test",
        password: "worker-health-fixture-password",
      })
    ).json(),
  ).token;
});
afterAll(async () => {
  await app?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  await database.destroy();
});

test("operations observes durable worker cycles without coupling API health or growing command history", async () => {
  expect((await request("/health")).status).toBe(200);
  const unknown = await operations();
  expect(unknown).toHaveLength(ContextName.options.length);
  for (const context of unknown)
    expect(context.worker).toMatchObject({ status: "unknown", lastSeen: null, staleAt: null });

  const worker = new Worker(app);
  for (let cycle = 0; cycle < 10; cycle++) {
    await worker.once();
    if ((await operations()).every((context) => context.pending === 0)) break;
  }
  const observed = await operations();
  for (const context of observed) {
    expect(context.pending).toBe(0);
    expect(context.worker.status).toBe("recent");
    const lastSeen = Date.parse(context.worker.lastSeen ?? "");
    const staleAt = Date.parse(context.worker.staleAt ?? "");
    expect(staleAt - lastSeen).toBe(30_000);
    expect(Date.parse(context.worker.observedAt)).toBeGreaterThanOrEqual(lastSeen);
    expect(Date.parse(context.worker.observedAt)).toBeLessThan(staleAt);
  }
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    // Read-only SQL verifies bounded operational storage independently of the HTTP view.
    async function counts() {
      const counts: {
        observations: number;
        commands: number;
        revisions: number;
        messages: number;
      }[] = [];
      for (const context of ContextName.options) {
        const result = await client.query<(typeof counts)[number]>(
          `SELECT (SELECT count(*)::int FROM ${context}.worker_observation) AS observations,
          (SELECT count(*)::int FROM ${context}.idempotency) AS commands,
          (SELECT count(*)::int FROM ${context}.revisions) AS revisions,
          (SELECT count(*)::int FROM ${context}.outbox) AS messages`,
        );
        counts.push(result.rows[0]);
      }
      return counts;
    }
    const before = await counts();
    for (const count of before) expect(count.observations).toBe(1);
    await worker.once();
    await worker.once();
    expect(await counts()).toEqual(before);
    // Only this isolated fixture's non-authoritative observation metadata is aged.
    // Domain records and command history remain untouched.
    for (const context of ContextName.options)
      await client.query(
        `UPDATE ${context}.worker_observation SET last_seen=clock_timestamp()-interval '31 seconds'`,
      );
    for (const context of await operations()) {
      expect(context.worker.status).toBe("stale");
      expect(Date.parse(context.worker.staleAt ?? "")).toBeLessThan(
        Date.parse(context.worker.observedAt),
      );
    }
    expect((await request("/health")).status).toBe(200);
    expect(await counts()).toEqual(before);
  } finally {
    await client.end();
  }
  const durable = await operations();
  await app.close();
  app = await createApplication(config());
  expect((await operations()).map((context) => context.worker.lastSeen)).toEqual(
    durable.map((context) => context.worker.lastSeen),
  );
  expect((await request("/health")).status).toBe(200);
  await new Worker(app).once();
  expect((await operations()).every((context) => context.worker.status === "recent")).toBe(true);
});
