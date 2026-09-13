import { randomUUID } from "node:crypto";
import { starterPlaybook } from "@aa/catalog/starters";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import { isolatedDatabase } from "../fixtures/database.ts";

const database = isolatedDatabase();
let app: Application, org: string, token: string;
const config = {
  databaseUrl: database.url,
  sessionKey: "publication-policy-test-signing-key",
  deploymentId: "publication-policy-test",
  publicationPolicy: "invitation" as const,
};
const call = async (path: string, body?: unknown) => {
  const response = await app.router.app.request(`http://localhost/api/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Organization-Id": org,
      "Idempotency-Key": randomUUID(),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
};
beforeAll(async () => {
  await database.create();
  app = await createApplication(config);
  const email = `publisher-${randomUUID()}@example.test`;
  org = (
    await app.access.bootstrap({
      email,
      name: "Publisher",
      password: "publication-policy-password",
      organizationName: "Publishing",
    })
  ).organizationId;
  token = (await call("/auth/login", { email, password: "publication-policy-password" })).data
    .token;
});
afterAll(async () => {
  await app?.close();
  await database.destroy();
});
test("organization administration cannot bypass installation invitation or its revocation", async () => {
  const draft = (
    await call("/catalog/playbooks", {
      title: "Portable reference",
      definition: starterPlaybook("new-feature"),
    })
  ).data;
  const snapshot = (
    await call(`/collaboration/catalog/${draft.id}/candidates`, {
      epoch: draft.data.epoch,
      expectedSequence: 0,
    })
  ).data;
  const version = (
    await call(`/catalog/playbooks/${draft.id}/publish`, {
      candidateId: snapshot.id,
      expectedHead: 0,
    })
  ).data;
  async function candidate(name: string) {
    return (
      await call("/community/candidates", {
        versionId: version.id,
        namespace: `invited-${org}`,
        name,
        summary: "Reviewed portable reference",
        tags: ["test"],
        authorName: "Publisher",
        organizationName: "Publishing",
      })
    ).data;
  }
  const first = await candidate("First");
  const command = { candidateId: first.id, digest: first.data.digest, expectedPolicyVersion: 0 };
  const denied = await call("/community/releases", command);
  expect(denied.status).toBe(403);
  expect(denied.data.code).toBe("publication_invitation_required");
  await app.close();
  app = await createApplication({ ...config, invitedPublisherOrganizations: [org] });
  const published = await call("/community/releases", command);
  expect(published.status, JSON.stringify(published.data)).toBe(200);
  const second = await candidate("Second");
  await app.close();
  app = await createApplication(config);
  const revoked = await call("/community/releases", {
    candidateId: second.id,
    digest: second.data.digest,
    expectedPolicyVersion: 0,
  });
  expect(revoked.status).toBe(403);
  expect(revoked.data.code).toBe("publication_invitation_required");
  expect((await call(`/community/releases/${published.data.id}`)).status).toBe(200);
});
