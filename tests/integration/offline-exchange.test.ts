import { randomUUID } from "node:crypto";
import { verifyPackage } from "@aa/catalog/package";
import { starterPlaybook } from "@aa/catalog/starters";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import { isolatedDatabase } from "../fixtures/database.ts";

const databases = [isolatedDatabase(), isolatedDatabase()];
const applications: Application[] = [];
const envelope = z.object({ id: z.uuid(), data: z.record(z.string(), z.unknown()) });
const archiveSchema = z.object({ archiveBase64: z.string() });
beforeAll(async () => {
  for (const database of databases) await database.create();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  for (const app of applications) await app.close();
  for (const database of databases) await database.destroy();
});

test("two independent local installations exchange complete packages with the source stopped and outbound HTTP unavailable", async () => {
  const network = vi.fn(() => Promise.reject(new Error("Outbound HTTP is unavailable")));
  vi.stubGlobal("fetch", network);
  async function installation(index: number) {
    const app = await createApplication({
      databaseUrl: databases[index].url,
      sessionKey: `offline-installation-${index}-independent-signing-key`,
      deploymentId: `offline-installation-${index}`,
    });
    applications.push(app);
    const email = `offline-${randomUUID()}@example.test`;
    const account = await app.access.bootstrap({
      email,
      password: "offline-installation-password",
      name: "Offline operator",
      organizationName: `Independent installation ${index}`,
    });
    let token = "";
    async function request(path: string, body?: unknown) {
      const response = await app.router.app.request(`http://local/api/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Organization-Id": account.organizationId,
          "Idempotency-Key": randomUUID(),
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data: unknown = await response.json();
      expect(response.status, JSON.stringify(data)).toBe(200);
      return data;
    }
    token = z
      .object({ token: z.string() })
      .parse(
        await request("/auth/login", { email, password: "offline-installation-password" }),
      ).token;
    return { app, request };
  }
  const source = await installation(0);
  const definition = starterPlaybook("bug-fix");
  const draft = envelope.parse(
    await source.request("/catalog/playbooks", {
      title: "Offline bug-fix starter",
      definition,
    }),
  );
  const candidate = envelope.parse(
    await source.request(`/collaboration/catalog/${draft.id}/candidates`, {
      epoch: draft.data.epoch,
      expectedSequence: 0,
    }),
  );
  const version = envelope.parse(
    await source.request(`/catalog/playbooks/${draft.id}/publish`, {
      candidateId: candidate.id,
      expectedHead: 0,
    }),
  );
  const exported = archiveSchema.parse(
    await source.request(`/catalog/versions/${version.id}/export`, {}),
  );
  const before = verifyPackage(Buffer.from(exported.archiveBase64, "base64"));
  expect(before.manifest.components.length).toBeGreaterThan(1);
  await source.app.close();
  applications.splice(applications.indexOf(source.app), 1);

  const destination = await installation(1);
  const imported = envelope.parse(await destination.request("/catalog/packages/import", exported));
  expect(imported.data.executionGrant).toBeNull();
  const repeated = envelope.parse(await destination.request("/catalog/packages/import", exported));
  expect(repeated.id).toBe(imported.id);
  const returned = archiveSchema.parse(
    await destination.request(`/catalog/packages/${imported.id}/export`),
  );
  const after = verifyPackage(Buffer.from(returned.archiveBase64, "base64"));
  expect(after.manifest).toEqual(before.manifest);
  expect(after.definitions).toEqual(before.definitions);
  expect(after.blobs).toEqual(before.blobs);
  expect(network).not.toHaveBeenCalled();
});
