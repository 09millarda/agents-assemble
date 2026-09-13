import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication } from "../../../apps/api/src/app.ts";
import { testDatabaseUrl as databaseUrl } from "../../../scripts/test-database.ts";
import { canonical, digest } from "./definition.ts";
import {
  packageDefinition,
  readStoredArchive,
  verifyPackage,
  writeStoredArchive,
} from "./package.ts";
import { starterPlaybook } from "./starters.ts";

describe("public Catalog, Knowledge and Community with real PostgreSQL", () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let organizationId: string;
  let token: string;
  let secondOrg: string;
  let secondToken: string;
  const config = {
    databaseUrl,
    sessionKey: "catalog-acceptance-at-least-32-chars",
    deploymentId: "catalog-acceptance",
  };
  async function request(path: string, body?: unknown, key: string = randomUUID(), other = false) {
    return app.router.app.request(`http://local/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        Authorization: `Bearer ${other ? secondToken : token}`,
        "X-Organization-Id": other ? secondOrg : organizationId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function ok(path: string, body?: unknown, key?: string, other = false) {
    const response = await request(path, body, key, other);
    const data = await response.json();
    expect(response.status, JSON.stringify(data)).toBe(200);
    return data;
  }
  beforeAll(async () => {
    app = await createApplication(config);
    for (const other of [false, true]) {
      const email = `catalog-${randomUUID()}@example.test`;
      const account = await app.access.bootstrap({
        email,
        name: other ? "Reader" : "Publisher",
        password: "test-password-long-enough",
        organizationName: other ? "Import destination" : "Publisher organization",
      });
      if (other) secondOrg = account.organizationId;
      else organizationId = account.organizationId;
      const login = await ok("/auth/login", { email, password: "test-password-long-enough" });
      if (other) secondToken = login.token;
      else token = login.token;
    }
  });
  afterAll(async () => {
    await app?.close();
  });
  it("freezes exact owner candidates and rejects competing submissions while retaining history across restart", async () => {
    const draft = await ok("/knowledge/documents", {
      title: "Specification",
      content: "Reviewed original",
    });
    const path = `/collaboration/knowledge/${draft.id}`;
    const candidate = await ok(`${path}/candidates`, {
      epoch: draft.data.epoch,
      expectedSequence: 0,
    });
    const edited = await ok(`${path}/replace`, {
      epoch: draft.data.epoch,
      expectedSequence: 0,
      content: "Later unsubmitted work",
    });
    expect(edited.status).toBe("accepted");
    const key = randomUUID();
    const revision = await ok(
      `${path}/submit`,
      { candidateId: candidate.id, expectedHead: 0 },
      key,
    );
    expect(revision.data.content).toBe("Reviewed original");
    expect(await ok(`${path}/submit`, { candidateId: candidate.id, expectedHead: 0 }, key)).toEqual(
      revision,
    );
    expect(
      (await request(`${path}/submit`, { candidateId: candidate.id, expectedHead: 0 })).status,
    ).toBe(409);
    await app.close();
    app = await createApplication(config);
    expect((await ok(`/knowledge/revisions/${revision.id}`)).data.content).toBe(
      "Reviewed original",
    );
    expect((await ok(path)).data.content).toBe("Later unsubmitted work");
    expect((await request(path, undefined, undefined, true)).status).toBe(404);
  });
  it("retains exact stale replacement conflicts and keeps publish blocked until explicitly resolved", async () => {
    const draft = await ok("/catalog/playbooks", {
      title: "Feature",
      definition: starterPlaybook("new-feature"),
    });
    const path = `/collaboration/catalog/${draft.id}`;
    const initial = await ok(path);
    const target = initial.data.graph.entities.find(
      (entity: { fields: { id?: string } }) => entity.fields.id === "discovery",
    );
    const command = {
      epoch: draft.data.epoch,
      baseSequence: 0,
      command: { type: "field", entityId: target.entityId, path: ["runtime"], value: "author" },
    };
    expect((await ok(`${path}/graph`, command)).status).toBe("accepted");
    const conflict = await ok(`${path}/graph`, {
      ...command,
      command: { ...command.command, value: "researcher" },
    });
    expect(conflict.status).toBe("conflict");
    expect(
      (await request(`${path}/candidates`, { epoch: draft.data.epoch, expectedSequence: 1 }))
        .status,
    ).toBe(409);
    await ok(`${path}/conflicts/${conflict.conflictId}/resolve`, { expectedSequence: 1 });
    const candidate = await ok(`${path}/candidates`, {
      epoch: draft.data.epoch,
      expectedSequence: 1,
    });
    expect(candidate.data.content.body.children[0].runtime).toBe("author");
    const invalidBatch = await ok(`${path}/graph`, {
      epoch: draft.data.epoch,
      baseSequence: 1,
      command: {
        type: "batch",
        commands: [
          { type: "field", entityId: target.entityId, path: ["runtime"], value: "researcher" },
          {
            type: "move",
            entityId: initial.data.graph.root,
            from: { parent: initial.data.graph.root, slot: "children" },
            to: { parent: initial.data.graph.root, slot: "children", index: 0 },
          },
        ],
      },
    });
    expect(invalidBatch.status).toBe("conflict");
    const unchanged = await ok(path);
    expect(unchanged.data.sequence).toBe(1);
    expect(unchanged.data.content).toEqual(candidate.data.content);
  });
  it("validates runtime profile requests at ingress and retains immutable prior revisions", async () => {
    const body = {
      name: "Codex",
      harness: "codex",
      model: "gpt-5.4",
      effort: "high",
      sandbox: "workspace-write",
      trustedRunner: true,
      codexVersion: "0.153.4",
      capabilities: [
        "native-account",
        "structured-results",
        "durable-human-requests",
        "checkpoint-recovery",
      ],
    };
    expect(
      (await request("/runtime-profiles", { ...body, capabilities: ["automatic-takeover"] }))
        .status,
    ).toBe(400);
    const unsupported = starterPlaybook("new-feature");
    expect(
      (
        await request("/catalog/playbooks", {
          title: "Unsupported capability",
          definition: {
            ...unsupported,
            runtimeSlots: { author: { harness: "codex", capabilities: ["magic"] } },
          },
        })
      ).status,
    ).toBe(400);
    const first = await ok("/runtime-profiles", body);
    const second = await ok(`/runtime-profiles/${first.id}/revisions`, {
      ...body,
      effort: "medium",
    });
    expect(second.id).not.toBe(first.id);
    expect(second.data.parentId).toBe(first.id);
    expect(second.data.digest).not.toBe(first.data.digest);
    const profiles = await ok("/runtime-profiles");
    expect(profiles.items.find((item: { id: string }) => item.id === first.id).data.effort).toBe(
      "high",
    );
    expect((await request("/runtime-profiles", { ...body, modelApiKey: "forbidden" })).status).toBe(
      400,
    );
    expect(
      (await request("/runtime-profiles", { ...body, sandbox: "danger-full-access" })).status,
    ).toBe(400);
  });
  it("rejects unsupported adapter semantics through the public validation and draft entry points", async () => {
    const definition = starterPlaybook("new-feature");
    const { digest: _prior, ...prior } = definition.dependencies.prepare;
    const unsupported = { ...prior, adapter: "start-model-instead" };
    definition.dependencies.prepare = { ...unsupported, digest: digest(unsupported) };
    for (const path of ["/catalog/validate", "/catalog/playbooks"]) {
      const result = await request(path, {
        ...(path.endsWith("playbooks") ? { title: "Unsupported adapter" } : {}),
        definition,
      });
      expect(result.status).toBe(400);
      expect(await result.text()).toContain("unsupported_adapter");
    }
    const unsupportedVersion = { ...prior, adapterVersion: "9.0.0" };
    definition.dependencies.prepare = { ...unsupportedVersion, digest: digest(unsupportedVersion) };
    const result = await request("/catalog/validate", { definition });
    expect(result.status).toBe(400);
    expect(await result.text()).toContain("unsupported_adapter_version");
  });
  it("publishes exact bytes, keeps feedback private, imports offline, and applies independent moderation", async () => {
    const draft = await ok("/catalog/playbooks", {
      title: "Portable",
      definition: starterPlaybook("new-feature"),
    });
    const candidate = await ok(`/collaboration/catalog/${draft.id}/candidates`, {
      epoch: draft.data.epoch,
      expectedSequence: 0,
    });
    const version = await ok(`/catalog/playbooks/${draft.id}/publish`, {
      candidateId: candidate.id,
      expectedHead: 0,
    });
    const namespace = `test-${randomUUID()}`;
    const publicCandidate = await ok("/community/candidates", {
      versionId: version.id,
      namespace,
      name: "Feature",
      summary: "A portable reference",
      tags: ["feature"],
      authorName: "Selected publisher",
      organizationName: "Selected organization",
    });
    const key = randomUUID();
    const publication = {
      candidateId: publicCandidate.id,
      digest: publicCandidate.data.digest,
      expectedPolicyVersion: 0,
    };
    const release = await ok("/community/releases", publication, key);
    expect(await ok("/community/releases", publication, key)).toEqual(release);
    const publicRead = await app.router.app.request(
      `http://local/api/v1/community/releases/${release.id}`,
    );
    const publicBody = await publicRead.json();
    expect(JSON.stringify(publicBody)).not.toContain(organizationId);
    expect(JSON.stringify(publicBody)).not.toContain(version.id);
    expect(
      (
        await request(`/community/releases/${release.id}/rating`, {
          score: 5,
          reviewedVersion: "1.0.0",
        })
      ).status,
    ).toBe(403);
    await ok(
      `/community/releases/${release.id}/rating`,
      { score: 4, reviewedVersion: "1.0.0" },
      undefined,
      true,
    );
    await ok(
      `/community/releases/${release.id}/rating`,
      { score: 5, reviewedVersion: "1.0.0" },
      undefined,
      true,
    );
    await ok(`/community/releases/${release.id}/bookmark`, { saved: true }, undefined, true);
    await ok(
      "/community/reports",
      {
        targetType: "release",
        targetId: release.id,
        category: "security",
        explanation: "Private evidence marker",
        evidence: [],
      },
      undefined,
      true,
    );
    const visible = await ok(`/community/releases/${release.id}`);
    expect(visible.rating).toEqual({ count: 1, average: 5 });
    expect(JSON.stringify(visible)).not.toContain("Private evidence marker");
    expect((await ok("/community/bookmarks")).items).toHaveLength(0);
    const archive = await ok(`/community/releases/${release.id}/export`);
    const imported = await ok("/catalog/packages/import", archive, undefined, true);
    expect(imported.data.executionGrant).toBeNull();
    const exportedAgain = await ok(
      `/catalog/packages/${imported.id}/export`,
      undefined,
      undefined,
      true,
    );
    expect(verifyPackage(Buffer.from(exportedAgain.archiveBase64, "base64")).manifest.root).toBe(
      release.root,
    );
    const decision = await ok("/community/moderation", {
      targetId: release.id,
      action: "quarantine",
      expectedVersion: release.aggregateVersion,
      reason: "Review the report",
      category: "security",
    });
    expect((await request(`/community/releases/${release.id}/export`)).status).toBe(410);
    expect(
      (
        await request("/community/moderation", {
          targetId: release.id,
          action: "restore",
          expectedVersion: release.aggregateVersion,
          reason: "stale",
          category: "resolved",
        })
      ).status,
    ).toBe(409);
    expect(
      (await ok(`/catalog/packages/${imported.id}/export`, undefined, undefined, true))
        .archiveBase64,
    ).toBe(exportedAgain.archiveBase64);
    expect(decision.data.resultingVersion).toBeGreaterThan(release.aggregateVersion);
  });
  it("retains publisher evidence across unsigned replay and re-evaluates attribution after trust changes", async () => {
    const origin = {
      installation: randomUUID(),
      organization: randomUUID(),
      package: randomUUID(),
    };
    const unsigned = packageDefinition(starterPlaybook("bug-fix"), origin),
      entries = readStoredArchive(unsigned),
      raw = entries.get("manifest.json");
    if (!raw) throw new Error("Missing fixture manifest");
    const manifest = JSON.parse(raw.toString()),
      keys = generateKeyPairSync("ed25519"),
      keyId = randomUUID();
    const proof = {
      component: manifest.root,
      keyId,
      signature: sign(
        null,
        Buffer.concat([
          Buffer.from("agents-assemble/package-component/v1\0"),
          Buffer.from(manifest.root, "hex"),
        ]),
        keys.privateKey,
      ).toString("base64"),
    };
    manifest.proofs = [proof];
    entries.set("manifest.json", Buffer.from(canonical(manifest)));
    app.catalog.trust.push({
      keyId,
      publicKey: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
      installation: origin.installation,
      organization: origin.organization,
    });
    const imported = await ok("/catalog/packages/import", {
      archiveBase64: writeStoredArchive(entries).toString("base64"),
    });
    expect(imported.data.attribution[manifest.root]).toMatchObject({ status: "verified", keyId });
    const replay = await ok("/catalog/packages/import", {
      archiveBase64: unsigned.toString("base64"),
    });
    expect(replay.id).toBe(imported.id);
    expect(replay.data.attribution[manifest.root].status).toBe("verified");
    const withProof = await ok(`/catalog/packages/${imported.id}/export`);
    expect(
      verifyPackage(Buffer.from(withProof.archiveBase64, "base64"), app.catalog.trust).manifest
        .proofs,
    ).toEqual([proof]);
    app.catalog.trust.splice(
      app.catalog.trust.findIndex((key) => key.keyId === keyId),
      1,
    );
    const current = await ok(`/catalog/packages/${imported.id}`);
    expect(current.data.attribution[manifest.root].status).toBe("unverified");
    expect(current.data.manifest.root).toBe(manifest.root);
    expect(
      verifyPackage(
        Buffer.from((await ok(`/catalog/packages/${imported.id}/export`)).archiveBase64, "base64"),
      ).manifest.proofs,
    ).toEqual([]);
  });
});
