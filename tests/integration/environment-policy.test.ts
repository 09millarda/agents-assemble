import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import { isolatedDatabase } from "../fixtures/database.ts";

const database = isolatedDatabase();
const profileSchema = z.strictObject({
  name: z.string(),
  variables: z.record(z.string(), z.string()),
  secretBindings: z.array(z.strictObject({ name: z.string(), logicalName: z.string() })),
  resolverPolicy: z.literal("local-file"),
  rotationPolicy: z.literal("refresh_per_attempt"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive(),
  active: z.boolean(),
});
const envelopeSchema = z.object({ id: z.uuid(), version: z.number(), data: profileSchema });
const profile = {
  name: "Payments service",
  variables: { SERVICE_MODE: "staging" },
  secretBindings: [{ name: "PAYMENTS_TOKEN", logicalName: "payments.token" }],
  resolverPolicy: "local-file",
  rotationPolicy: "refresh_per_attempt",
};
let app: Application, directory: string, token: string, organizationId: string;
async function call(path: string, body?: unknown) {
  const response = await app.router.app.request(`http://localhost/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Organization-Id": organizationId,
      "Idempotency-Key": randomUUID(),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json();
  return { status: response.status, data };
}
async function createProfile() {
  const response = await call("/environments", profile);
  expect(response.status, JSON.stringify(response.data)).toBe(200);
  return envelopeSchema.parse(response.data);
}
beforeAll(async () => {
  await database.create();
  directory = await mkdtemp(join(tmpdir(), "aa-environment-policy-"));
  app = await createApplication({
    databaseUrl: database.url,
    stateDirectory: directory,
    deploymentId: "environment-policy-fixture",
    sessionKey: "environment-policy-fixture-signing-key-at-least-32-characters",
  });
  organizationId = (
    await app.access.bootstrap({
      email: "environment-owner@example.test",
      name: "Environment owner",
      password: "environment-policy-fixture-password",
      organizationName: "Environment policy",
    })
  ).organizationId;
  token = z.object({ token: z.string() }).parse(
    (
      await call("/auth/login", {
        email: "environment-owner@example.test",
        password: "environment-policy-fixture-password",
      })
    ).data,
  ).token;
});
afterAll(async () => {
  await app?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  await database.destroy();
});

test.each([
  { resolverPolicy: "environment", rotationPolicy: "refresh_per_attempt" },
  { resolverPolicy: "local-file", rotationPolicy: "pinned" },
  { resolverPolicy: "environment", rotationPolicy: "pinned" },
])(
  "unsupported $resolverPolicy / $rotationPolicy cannot create or revise a profile",
  async (policy) => {
    const unsupported = { ...profile, ...policy };
    const deniedCreate = await call("/environments", unsupported);
    expect(deniedCreate.status).toBe(400);
    expect(z.object({ code: z.string() }).parse(deniedCreate.data).code).toBe("validation_error");
    const accepted = await createProfile();
    const deniedRevision = await call(`/environments/${accepted.id}/revisions`, {
      expectedVersion: accepted.version,
      profile: unsupported,
    });
    expect(deniedRevision.status).toBe(400);
    expect(envelopeSchema.parse((await call(`/environments/${accepted.id}`)).data)).toEqual(
      accepted,
    );
  },
);

test("supported revisions retain exact history and expose logical secret bindings only", async () => {
  const first = await createProfile();
  expect(first.data).toMatchObject({ ...profile, revision: 1, active: true });
  const marker = "fixture-secret-value-must-not-enter-control-plane";
  const withSecretValue = {
    ...profile,
    secretBindings: [{ ...profile.secretBindings[0], value: marker }],
  };
  for (const [path, body] of [
    ["/environments", withSecretValue],
    [
      `/environments/${first.id}/revisions`,
      { expectedVersion: first.version, profile: withSecretValue },
    ],
  ] as const) {
    const rejected = await call(path, body);
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.data)).not.toContain(marker);
  }
  const revisedProfile = {
    ...profile,
    variables: { SERVICE_MODE: "production" },
    secretBindings: [{ name: "PAYMENTS_TOKEN", logicalName: "payments.token.next" }],
  };
  const revised = await call(`/environments/${first.id}/revisions`, {
    expectedVersion: first.version,
    profile: revisedProfile,
  });
  expect(revised.status, JSON.stringify(revised.data)).toBe(200);
  const second = envelopeSchema.parse(revised.data);
  expect(second).toMatchObject({
    id: first.id,
    version: 2,
    data: { ...revisedProfile, revision: 2 },
  });
  expect(second.data.digest).not.toBe(first.data.digest);
  const current = await call(`/environments/${first.id}`);
  expect(envelopeSchema.parse(current.data)).toEqual(second);
  const listed = z
    .object({ items: z.array(envelopeSchema) })
    .parse((await call("/environments")).data);
  expect(listed.items.find((item) => item.id === first.id)).toEqual(second);
  expect(JSON.stringify([current.data, listed])).not.toContain(marker);

  // Read-only PostgreSQL verifies append-only history in this owned fixture database.
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    const history = await client.query<{ version: number; data: unknown }>(
      "SELECT version,data FROM environments.revisions WHERE organization_id=$1 AND kind='environment' AND aggregate_id=$2 ORDER BY version",
      [organizationId, first.id],
    );
    expect(history.rows).toEqual([
      { version: 1, data: first.data },
      { version: 2, data: second.data },
    ]);
  } finally {
    await client.end();
  }
});
