import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApplication } from "../../apps/api/src/app.ts";
import { migrate } from "../../scripts/migrate.ts";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://agents_assemble:local-development-only@127.0.0.1:55433/agents_assemble_test";
describe("public control-plane boundary with PostgreSQL", () => {
  let application: Awaited<ReturnType<typeof createApplication>>;
  let token: string;
  let organizationId: string;
  const email = `owner-${randomUUID()}@example.test`;
  const request = async (path: string, body?: unknown, key = randomUUID()) =>
    application.router.app.request(`http://localhost/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        Authorization: `Bearer ${token}`,
        "X-Organization-Id": organizationId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  beforeAll(async () => {
    await migrate(databaseUrl);
    application = await createApplication({
      databaseUrl,
      sessionKey: "test-session-key-at-least-32-characters",
      deploymentId: "test",
    });
    const account = await application.access.bootstrap({
      email,
      name: "Owner",
      password: "a-long-test-password",
      organizationName: "Acceptance",
    });
    organizationId = account.organizationId;
    const login = await request("/auth/login", { email, password: "a-long-test-password" });
    expect(login.status).toBe(200);
    token = (await login.json()).token;
  });
  afterAll(async () => {
    await application?.close();
  });
  test("authentication and organization scope precede resource disclosure", async () => {
    const response = await application.router.app.request(
      "http://localhost/api/v1/projects/00000000-0000-4000-8000-000000000000",
    );
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("unauthorized");
  });
  test("Zod validates path identities after authentication and documents UUID parameters", async () => {
    const unauthenticated = await application.router.app.request(
      "http://localhost/api/v1/projects/not-a-uuid",
    );
    expect(unauthenticated.status).toBe(401);
    const invalid = await request("/projects/not-a-uuid");
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe("invalid_path");
    expect((await request("/operations/not-a-context/messages")).status).toBe(400);
    const document = await (
      await application.router.app.request("http://localhost/api/v1/openapi.json")
    ).json();
    expect(
      document.paths["/api/v1/projects/{id}"].get.parameters.find(
        (item: { name: string }) => item.name === "id",
      ).schema.format,
    ).toBe("uuid");
  });
  test("idempotent project creation, conflict and immutable history survive application restart", async () => {
    const key = randomUUID();
    const first = await request(
      "/projects",
      { name: "Delivery", description: "First release" },
      key,
    );
    expect(first.status).toBe(200);
    const created = await first.json();
    const duplicate = await request(
      "/projects",
      { name: "Delivery", description: "First release" },
      key,
    );
    expect(await duplicate.json()).toEqual(created);
    const conflict = await request("/projects", { name: "Other" }, key);
    expect(conflict.status).toBe(409);
    await application.close();
    application = await createApplication({
      databaseUrl,
      sessionKey: "test-session-key-at-least-32-characters",
      deploymentId: "test",
    });
    const retained = await request(`/projects/${created.id}`);
    expect(await retained.json()).toEqual(created);
  });
  test("Zod rejects unknown command fields and OpenAPI documents the same route", async () => {
    const rejected = await request("/projects", { name: "Bad", secret: "must not persist" });
    expect(rejected.status).toBe(400);
    const spec = await request("/openapi.json");
    expect(spec.status).toBe(200);
    expect(
      (await spec.json()).paths["/api/v1/projects"].post.requestBody.content["application/json"]
        .schema.additionalProperties,
    ).toBe(false);
  });
});
