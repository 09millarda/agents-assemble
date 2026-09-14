import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalAccess } from "../../../apps/api/src/access.ts";
import { Fleet } from "../../../apps/api/src/fleet.ts";
import { createRunnerTlsServer } from "../../../apps/api/src/tls.ts";
import { migrate } from "../../../scripts/migrate.ts";
import { ApiRouter } from "../../platform/src/http.ts";
import { ContextStore } from "../../platform/src/store.ts";
import { RunnerDaemon } from "../src/daemon.ts";
import { doctor } from "../src/native.ts";
import { PROTOCOL_VERSION } from "../src/protocol.ts";
import { RunnerTransport, runnerConfigSchema } from "../src/transport.ts";

const exec = promisify(execFile);
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://agents_assemble:local-development-only@127.0.0.1:55433/agents_assemble_test";
describe("real CLI enrollment and mTLS Fleet boundary", () => {
  let directory: string,
    runnerDirectory: string,
    url: string,
    organizationId: string,
    token: string,
    router: ApiRouter,
    access: LocalAccess,
    fleet: Fleet,
    server: Server;
  let stores: ContextStore[] = [];
  const request = async (path: string, body?: unknown) =>
    router.app.request(`http://localhost/api/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        authorization: `Bearer ${token}`,
        "x-organization-id": organizationId,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  beforeAll(async () => {
    await migrate(databaseUrl);
    directory = await mkdtemp(join(tmpdir(), "aa-fleet-"));
    runnerDirectory = join(directory, "runner");
    stores = [new ContextStore("access", databaseUrl), new ContextStore("fleet", databaseUrl)];
    access = new LocalAccess(stores[0], "runner-test-local-session-key-at-least-32-characters");
    router = new ApiRouter(access);
    fleet = new Fleet(stores[1], {
      deploymentId: "deployment-test",
      stateDirectory: join(directory, "server"),
      recheck: (actor) => access.recheck(actor, "admin"),
    });
    await fleet.initialize();
    access.register(router);
    fleet.register(router);
    const email = `fleet-${randomUUID()}@example.test`;
    const account = await access.bootstrap({
      email,
      name: "Fleet owner",
      password: "fleet-integration-password",
      organizationName: "Fleet integration",
    });
    organizationId = account.organizationId;
    const login = await request("/auth/login", { email, password: "fleet-integration-password" });
    token = (await login.json()).token;
    server = await createRunnerTlsServer(router.app, fleet.authority);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing_tls_address");
    url = `https://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all(stores.map((store) => store.close()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("enrolls with a locally generated key and runs a fresh outbound daemon process", async () => {
    const challenge = await request("/fleet/enrollments", { name: "Conformance runner" });
    expect(challenge.status).toBe(200);
    const authorization = await challenge.json();
    const tokenFile = join(directory, "enrollment-token");
    await writeFile(tokenFile, authorization.enrollmentToken, { mode: 0o600 });
    const fakeCodex = join(directory, "codex");
    await writeFile(
      fakeCodex,
      `#!/usr/bin/env node\nif(process.argv.includes('--version')){console.log('codex-cli 0.153.4');process.exit(0)}\nconst readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);if(request.id===undefined)return;const result=request.method==='account/read'?{account:{type:'chatgpt'},requiresOpenaiAuth:true}:{};console.log(JSON.stringify({id:request.id,result}));});\n`,
      { mode: 0o700 },
    );
    const cli = resolve("apps/runner/src/cli.ts");
    const result = await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "enroll",
        "--directory",
        runnerDirectory,
        "--service",
        url,
        "--ca",
        join(fleet.authority.directory, "ca.pem"),
        "--token-file",
        tokenFile,
        "--codex",
        fakeCodex,
      ],
      { timeout: 15000 },
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "enrolled",
      runnerId: authorization.runnerId,
    });
    const config = runnerConfigSchema.parse(
      JSON.parse(await readFile(join(runnerDirectory, "config.json"), "utf8")),
    );
    expect(config.runnerId).toBe(authorization.runnerId);
    expect(await readFile(config.privateKeyFile, "utf8")).toContain("PRIVATE KEY");
    await exec(
      process.execPath,
      ["--import", "tsx", cli, "daemon", "run", "--once", "--directory", runnerDirectory],
      { timeout: 15000 },
    );
    const listing = await request("/runners");
    const items = (await listing.json()).items;
    expect(items[0]).toMatchObject({
      id: authorization.runnerId,
      status: "active",
      capabilities: {
        nativeLoginReady: true,
        writerCoverage: "incomplete",
        automaticTakeover: false,
      },
    });
    expect(JSON.stringify(items)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(items)).not.toContain(authorization.enrollmentToken);
  });
  it("refreshes presence on quiet daemon ticks without advancing the durable journal", async () => {
    const config = runnerConfigSchema.parse(
      JSON.parse(await readFile(join(runnerDirectory, "config.json"), "utf8")),
    );
    const daemon = new RunnerDaemon(runnerDirectory, config);
    try {
      await daemon.tick();
      const before = (await (await request("/runners")).json()).items[0];
      const sequence = daemon.journal.sequence;
      expect(daemon.journal.pendingReceipts()).toEqual([]);
      await daemon.tick();
      const after = (await (await request("/runners")).json()).items[0];
      expect(daemon.journal.sequence).toBe(sequence);
      expect(after.lastSequence).toBe(before.lastSequence);
      expect(Date.parse(after.lastSeenAt)).toBeGreaterThan(Date.parse(before.lastSeenAt));
      expect(await fleet.eligibleRunners(organizationId)).toContainEqual(
        expect.objectContaining({ id: config.runnerId, journalId: config.journalId }),
      );
    } finally {
      daemon.journal.close();
    }
  });
  it("rejects a claimed runner header and unauthenticated TLS even with valid JSON identities", async () => {
    const config = runnerConfigSchema.parse(
      JSON.parse(await readFile(join(runnerDirectory, "config.json"), "utf8")),
    );
    const payload = {
      version: PROTOCOL_VERSION,
      runnerId: config.runnerId,
      journalId: config.journalId,
      sequence: 0,
      capabilities: await doctor(config.codexBinary),
      receipts: [],
    };
    const forged = await router.app.request("http://localhost/api/v1/runner/reconcile", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        "x-runner-id": config.runnerId,
        "x-runner-organization": organizationId,
      },
      body: JSON.stringify(payload),
    });
    expect(forged.status).toBe(401);
    expect((await forged.json()).code).toBe("runner_mtls_required");
    const anonymous = new RunnerTransport(url, { caFile: config.caFile });
    await expect(anonymous.post("/api/v1/runner/reconcile", payload)).rejects.toThrow(
      "runner_http_401",
    );
  });
  it("keeps exact heartbeat retries idempotent and records a new observation independently", async () => {
    const config = runnerConfigSchema.parse(
      JSON.parse(await readFile(join(runnerDirectory, "config.json"), "utf8")),
    );
    const transport = new RunnerTransport(url, config);
    const payload = {
      version: PROTOCOL_VERSION,
      runnerId: config.runnerId,
      journalId: config.journalId,
      sequence: 0,
      capabilities: await doctor(config.codexBinary),
      receipts: [],
    };
    const operationId = randomUUID();
    await transport.post("/api/v1/runner/reconcile", payload, operationId);
    const first = (await (await request("/runners")).json()).items[0];
    await transport.post("/api/v1/runner/reconcile", payload, operationId);
    const replay = (await (await request("/runners")).json()).items[0];
    expect(replay).toEqual(first);
    await transport.post("/api/v1/runner/reconcile", payload, randomUUID());
    const next = (await (await request("/runners")).json()).items[0];
    expect(Date.parse(next.lastSeenAt)).toBeGreaterThan(Date.parse(first.lastSeenAt));
    expect(next.lastSequence).toBe(first.lastSequence);
    await transport.post("/api/v1/runner/reconcile", payload);
    const defaultFirst = (await (await request("/runners")).json()).items[0];
    await transport.post("/api/v1/runner/reconcile", payload);
    expect((await (await request("/runners")).json()).items[0]).toEqual(defaultFirst);
  });
  it("rotates the certificate without changing journal identity and revokes old-key operations", async () => {
    const config = runnerConfigSchema.parse(
      JSON.parse(await readFile(join(runnerDirectory, "config.json"), "utf8")),
    );
    const oldCertificate = join(directory, "old-certificate.pem");
    await writeFile(oldCertificate, await readFile(config.certificateFile), { mode: 0o600 });
    const oldTransport = new RunnerTransport(url, { ...config, certificateFile: oldCertificate });
    const challenge = await request("/fleet/enrollments", {
      name: "Rotated runner",
      runnerId: config.runnerId,
    });
    expect(challenge.status).toBe(200);
    const authorization = await challenge.json();
    const tokenFile = join(directory, "rotation-token");
    await writeFile(tokenFile, authorization.enrollmentToken, { mode: 0o600 });
    await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/runner/src/cli.ts"),
        "rotate",
        "--directory",
        runnerDirectory,
        "--token-file",
        tokenFile,
      ],
      { timeout: 15000 },
    );
    const rotated = runnerConfigSchema.parse(
      JSON.parse(await readFile(join(runnerDirectory, "config.json"), "utf8")),
    );
    expect(rotated.journalId).toBe(config.journalId);
    expect(rotated.credentialGeneration).toBe(2);
    const payload = {
      version: PROTOCOL_VERSION,
      runnerId: config.runnerId,
      journalId: config.journalId,
      sequence: 0,
      capabilities: await doctor(config.codexBinary),
      receipts: [],
    };
    await expect(oldTransport.post("/api/v1/runner/reconcile", payload)).rejects.toThrow(
      "runner_http_403",
    );
    const current = new RunnerTransport(url, rotated);
    expect(await current.post("/api/v1/runner/reconcile", payload)).toMatchObject({
      revoked: false,
      commands: [],
    });
    const rows = (await (await request("/runners")).json()).items;
    const revoked = await request(`/runners/${config.runnerId}/revoke`, {
      expectedVersion: rows[0].version,
      reason: "End conformance enrollment",
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({
      status: "revocation_pending",
      writerCoverage: "incomplete",
    });
    await expect(current.post("/api/v1/runner/reconcile", payload)).rejects.toThrow(
      "runner_http_403",
    );
  });
});
