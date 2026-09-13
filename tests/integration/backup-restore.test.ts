import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Definition, digest } from "@aa/catalog/definition";
import pg from "pg";
import { expect, test } from "vitest";
import { z } from "zod";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import type { RepositoryPort } from "../../apps/api/src/projects.ts";
import { Worker } from "../../apps/worker/src/worker.ts";
import { migrate } from "../../scripts/migrate.ts";

const run = promisify(execFile);
const postgresImage =
  "postgres:18.4@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636";
const idSchema = z.object({ id: z.uuid() });
const runEnvelope = idSchema
  .extend({
    version: z.number(),
    data: z
      .object({
        status: z.string(),
        manifest: z.unknown(),
        engine: z.object({ status: z.string() }).passthrough(),
        holds: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();
const sha = "a".repeat(40);
const repositories: RepositoryPort = {
  async resolve(owner, name) {
    return {
      provider: "github",
      providerId: "201",
      ownerId: "1",
      owner,
      name,
      url: `https://github.com/${owner}/${name}.git`,
      defaultBranch: "main",
      baseline: sha,
    };
  },
  async verifyCommit(_repository, commit) {
    return commit === sha;
  },
};

async function waitForDatabase(databaseUrl: string) {
  const deadline = Date.now() + 30000;
  for (;;) {
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
    } finally {
      await client.end();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("quiesced backup and fresh-database restore retain identity and immutable history while fencing active runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "aa-backup-"));
  const container = `aa-backup-${randomUUID()}`;
  const state = join(root, "identity"),
    backup = join(root, "backup"),
    restoredState = join(root, "restored");
  let app: Application | undefined;
  try {
    await run("docker", [
      "run",
      "--detach",
      "--name",
      container,
      "-e",
      "POSTGRES_USER=fixture",
      "-e",
      "POSTGRES_PASSWORD=fixture-only",
      "-e",
      "POSTGRES_DB=source",
      "-p",
      "127.0.0.1::5432",
      postgresImage,
    ]);
    const port = (await run("docker", ["port", container, "5432/tcp"])).stdout
      .trim()
      .split(":")
      .at(-1);
    const databaseUrl = `postgresql://fixture:fixture-only@127.0.0.1:${port}/source`;
    const restoredUrl = databaseUrl.replace(/\/source$/, "/restored");
    await waitForDatabase(databaseUrl);
    await migrate(databaseUrl);
    await mkdir(state, { mode: 0o700 });
    const sessionKey = "backup-qualification-signing-key-at-least-32-characters";
    await writeFile(join(state, "session.key"), sessionKey, { mode: 0o600 });
    app = await createApplication({
      databaseUrl,
      stateDirectory: state,
      sessionKey,
      deploymentId: "backup-qualification",
      repositories,
    });
    const { organizationId } = await app.access.bootstrap({
      email: "backup@example.test",
      password: "backup-fixture-password",
      name: "Backup operator",
      organizationName: "Backup qualification",
    });
    let token = "";
    const call = async (path: string, body?: unknown): Promise<unknown> => {
      if (!app) throw new Error("Fixture is quiesced");
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
      const value: unknown = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value;
    };
    token = z.object({ token: z.string() }).parse(
      await call("/auth/login", {
        email: "backup@example.test",
        password: "backup-fixture-password",
      }),
    ).token;
    const sessionBefore = await call("/auth/session");
    const project = idSchema.parse(await call("/projects", { name: "Recoverable delivery" }));
    const repository = idSchema.parse(
      await call(`/projects/${project.id}/repositories`, { owner: "fixture", name: "backup" }),
    );
    const action = {
      id: "confirm",
      version: "1.0.0",
      kind: "human" as const,
      executor: "service" as const,
      adapter: "confirm",
      adapterVersion: "1.0.0",
      inputs: {},
      outputs: { type: "boolean" },
      effect: "read" as const,
      permissions: [],
      capabilities: [],
      retry: { maxAttempts: 1, safeErrorClasses: [] },
      timeoutSeconds: 300,
      cancellation: "supported" as const,
    };
    const definition: Definition = {
      formatVersion: "agents-assemble.playbook/1",
      package: { id: "fixture/backup", version: "1.0.0" },
      inputs: {},
      outputs: {},
      dependencies: { confirm: { ...action, digest: digest(action) } },
      runtimeSlots: {},
      permissions: [],
      policy: {
        maxInvocations: 5,
        maxConcurrency: 1,
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
            with: { literal: { question: "Continue?" } },
          },
          { id: "end", type: "end", result: { ref: { source: "approval", pointer: "" } } },
        ],
      },
    };
    const draft = idSchema
      .extend({ data: z.object({ epoch: z.uuid() }) })
      .parse(await call("/catalog/playbooks", { title: "Backup fixture", definition }));
    const candidate = idSchema.parse(
      await call(`/collaboration/catalog/${draft.id}/candidates`, {
        epoch: draft.data.epoch,
        expectedSequence: 0,
      }),
    );
    const version = idSchema.parse(
      await call(`/catalog/playbooks/${draft.id}/publish`, {
        candidateId: candidate.id,
        expectedHead: 0,
      }),
    );
    const settle = async () => {
      if (!app) throw new Error("Fixture is quiesced");
      const worker = new Worker(app);
      for (let index = 0; index < 5; index++) await worker.once();
    };
    const start = async () =>
      idSchema.parse(
        await call("/runs", {
          projectId: project.id,
          repositoryId: repository.id,
          versionId: version.id,
          sourceCommit: sha,
          inputs: {},
          runtimeBindings: {},
        }),
      );
    const answer = async (runId: string) => {
      const requests = z
        .object({
          items: z.array(
            idSchema.extend({
              version: z.number(),
              data: z.object({ runId: z.string(), manifestDigest: z.string() }),
            }),
          ),
        })
        .parse(await call("/requests"));
      const request = requests.items.find((item) => item.data.runId === runId);
      if (!request) throw new Error("Expected a durable human wait");
      return call(`/requests/${request.id}/respond`, {
        expectedVersion: request.version,
        manifestDigest: request.data.manifestDigest,
        response: true,
        reason: "Reviewed exact backup fixture request",
      });
    };
    const completed = await start();
    await settle();
    await answer(completed.id);
    await settle();
    const completedBefore = runEnvelope.parse(await call(`/runs/${completed.id}`));
    expect(completedBefore.data.status).toBe("completed");
    const active = await start();
    await settle();
    const activeBefore = runEnvelope.parse(await call(`/runs/${active.id}`));
    expect(activeBefore.data.status).toBe("waiting");
    const versionsBefore = await call("/catalog/versions");
    await app.close();
    app = undefined;

    // Wrappers exercise the real PostgreSQL 18 CLIs without requiring host client packages.
    const bin = join(root, "bin");
    await mkdir(bin);
    for (const executable of ["pg_dump", "pg_restore"])
      await writeFile(
        join(bin, executable),
        `#!/usr/bin/env node
const {spawnSync}=require('node:child_process');
const {openSync,closeSync}=require('node:fs');
const command=${JSON.stringify(executable)},args=process.argv.slice(2);
let fd;
if(command==='pg_dump'){const index=args.indexOf('--file');fd=openSync(args[index+1],'wx',0o600);args.splice(index,2);}
else{fd=openSync(args.pop(),'r');}
const result=spawnSync('docker',['exec','-i','-e','PGHOST=127.0.0.1','-e','PGPORT=5432',...['PGUSER','PGPASSWORD','PGDATABASE'].flatMap(key=>['-e',key]),${JSON.stringify(container)},command,...args],{env:process.env,stdio:command==='pg_dump'?['ignore',fd,'inherit']:[fd,'inherit','inherit']});
closeSync(fd);if(result.error)throw result.error;process.exit(result.status??1);
`,
        { mode: 0o700 },
      );
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: databaseUrl,
      BACKUP_DATABASE_URL: databaseUrl,
      STATE_DIRECTORY: state,
      DEPLOYMENT_ID: "backup-qualification",
    };
    const cli = (
      script: "backup" | "restore",
      args: string[] = [],
      extra: NodeJS.ProcessEnv = {},
    ) =>
      run(process.execPath, ["--import", "tsx", `scripts/${script}.ts`, ...args], {
        env: { ...env, ...extra },
        timeout: 60000,
      });
    await expect(cli("backup", [`--directory=${backup}`])).rejects.toThrow("--quiesced");
    await expect(access(backup)).rejects.toThrow();
    await cli("backup", ["--quiesced", `--directory=${backup}`]);
    await expect(cli("backup", ["--quiesced", `--directory=${backup}`])).rejects.toThrow("EEXIST");
    expect((await stat(backup)).mode & 0o777).toBe(0o700);
    for (const name of ["manifest.json", "database.dump", "identity.tar.gz"])
      expect((await stat(join(backup, name))).mode & 0o777).toBe(0o600);
    const restoreEnv = {
      BACKUP_DIRECTORY: backup,
      RESTORE_DATABASE_URL: restoredUrl,
      RESTORE_STATE_DIRECTORY: restoredState,
    };
    const tampered = join(root, "tampered");
    await cp(backup, tampered, { recursive: true });
    await appendFile(join(tampered, "database.dump"), "tampered");
    await expect(cli("restore", [], { ...restoreEnv, BACKUP_DIRECTORY: tampered })).rejects.toThrow(
      "Backup integrity failed",
    );
    const exists = async (name: string) => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        return (await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [name])).rowCount;
      } finally {
        await client.end();
      }
    };
    expect(await exists("restored")).toBe(0);
    await expect(
      cli("restore", [], { ...restoreEnv, RESTORE_DATABASE_URL: databaseUrl }),
    ).rejects.toThrow("Destination database already exists");
    await expect(access(restoredState)).rejects.toThrow();
    const occupiedState = join(root, "occupied");
    await mkdir(occupiedState);
    await writeFile(join(occupiedState, "keep"), "pre-existing identity");
    await expect(
      cli("restore", [], {
        ...restoreEnv,
        RESTORE_DATABASE_URL: databaseUrl.replace(/\/source$/, "/occupied"),
        RESTORE_STATE_DIRECTORY: occupiedState,
      }),
    ).rejects.toThrow("Destination state directory already exists");
    expect(await exists("occupied")).toBe(0);
    expect(await readFile(join(occupiedState, "keep"), "utf8")).toBe("pre-existing identity");
    await cli("restore", [], restoreEnv);
    expect(await readFile(join(restoredState, "session.key"), "utf8")).toBe(sessionKey);
    for (const name of [
      "session.key",
      "runner-pki/ca-key.pem",
      "runner-pki/ca.pem",
      "runner-pki/server-key.pem",
      "runner-pki/server.pem",
      "runner-pki/enrollment-key",
    ])
      expect(await readFile(join(restoredState, name))).toEqual(await readFile(join(state, name)));
    app = await createApplication({
      databaseUrl: restoredUrl,
      stateDirectory: restoredState,
      sessionKey,
      deploymentId: "backup-qualification",
      repositories,
    });
    expect(await call("/auth/session")).toEqual(sessionBefore);
    expect(await call("/catalog/versions")).toEqual(versionsBefore);
    expect(runEnvelope.parse(await call(`/runs/${completed.id}`))).toEqual(completedBefore);
    const held = runEnvelope.parse(await call(`/runs/${active.id}`));
    expect(held.data.manifest).toEqual(activeBefore.data.manifest);
    expect(held.data.engine).toEqual(activeBefore.data.engine);
    expect(held.data.status).toBe("blocked");
    expect(held.data.holds.restore).toBeDefined();
    await answer(active.id);
    await settle();
    const reconciled = runEnvelope.parse(await call(`/runs/${active.id}`));
    expect(reconciled.data.status).toBe("blocked");
    expect(reconciled.data.holds.restore).toEqual(held.data.holds.restore);
    expect(reconciled.data.engine.status).not.toBe("completed");
    expect(reconciled.data.manifest).toEqual(activeBefore.data.manifest);
    await expect(cli("restore", [], restoreEnv)).rejects.toThrow(
      "Destination database already exists",
    );
  } finally {
    await app?.close();
    await run("docker", ["rm", "--force", "--volumes", container]);
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
