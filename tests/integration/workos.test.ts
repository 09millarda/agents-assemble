import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type Application, createApplication } from "../../apps/api/src/app.ts";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://agents_assemble:local-development-only@127.0.0.1:55433/agents_assemble_test";
const email = `external-${randomUUID()}@example.test`;
let active = true,
  exchanges = 0;
const provider = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/user_management/authenticate") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body.code_verifier || body.code !== "fixture-code") {
      res.statusCode = 400;
      res.end("{}");
      return;
    }
    exchanges++;
    res.end(
      JSON.stringify({
        user: {
          id: "user_fixture",
          email,
          email_verified: true,
          first_name: "Hosted",
          last_name: "Member",
        },
        access_token: `header.${Buffer.from(JSON.stringify({ sub: "user_fixture", sid: "session_fixture", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.trusted-exchange`,
      }),
    );
  } else
    res.end(
      JSON.stringify({
        data: active
          ? [
              {
                id: "session_fixture",
                user_id: "user_fixture",
                status: "active",
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              },
            ]
          : [],
        list_metadata: { after: null },
      }),
    );
});
let app: Application;
const call = (path: string, body?: unknown, token?: string) =>
  app.router.app.request(`http://localhost/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeAll(async () => {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("address");
  app = await createApplication({
    databaseUrl,
    sessionKey: "a-workos-fixture-key-more-than-32-characters",
    deploymentId: "workos-test",
    workos: {
      apiKey: "fixture-key",
      clientId: "fixture-client",
      redirectUri: "http://localhost/callback",
      apiBase: `http://127.0.0.1:${address.port}`,
    },
  });
  await app.access.bootstrap({
    email,
    name: "Hosted",
    organizationName: "Hosted fixture",
    password: "unused-local-password",
  });
});
afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});
test("hosted identity verifies browser proof and PKCE, deduplicates exchange, and honors provider revocation", async () => {
  expect((await call("/auth/login", { email, password: "unused-local-password" })).status).toBe(
    403,
  );
  const start = await (await call("/auth/workos/start", {})).json();
  const url = new URL(start.authorizationUrl);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")).toBe(start.state);
  expect(start.authorizationUrl).not.toContain(start.proof);
  expect(
    (
      await call("/auth/workos/complete", {
        state: start.state,
        proof: "incorrect",
        code: "fixture-code",
      })
    ).status,
  ).toBe(403);
  const body = { state: start.state, proof: start.proof, code: "fixture-code" };
  const completed = await call("/auth/workos/complete", body);
  expect(completed.status).toBe(200);
  const session = await completed.json();
  expect(await (await call("/auth/workos/complete", body)).json()).toEqual(session);
  expect(exchanges).toBe(1);
  expect((await call("/auth/session", undefined, session.token)).status).toBe(200);
  active = false;
  expect((await call("/auth/session", undefined, session.token)).status).toBe(401);
});
