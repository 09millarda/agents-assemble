import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Definition, digest } from "@aa/catalog/definition";
import pg from "pg";
import { expect, test } from "vitest";
import { createApplication } from "../../apps/api/src/app.ts";
import { migrate } from "../../scripts/migrate.ts";

async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 30000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error("Public state did not settle before deadline");
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}
const sha = "a".repeat(40);
test("HTTP decisions and seven-node execution survive SIGKILL of both processes and PostgreSQL restart", async () => {
  const container = `aa-conformance-${randomUUID()}`,
    state = await mkdtemp(join(tmpdir(), "aa-process-"));
  const reservation = createTcpServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const bound = reservation.address();
  if (!bound || typeof bound === "string") throw new Error("Port unavailable");
  const hostPort = bound.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const github = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        req.url?.includes("/commits/")
          ? { sha }
          : {
              id: 501,
              owner: { id: 1, login: "fixture" },
              name: "process",
              clone_url: "https://github.com/fixture/process.git",
              default_branch: "main",
            },
      ),
    );
  });
  let api: ChildProcess | undefined, worker: ChildProcess | undefined;
  try {
    execFileSync(
      "docker",
      [
        "run",
        "--detach",
        "--name",
        container,
        "-e",
        "POSTGRES_USER=fixture",
        "-e",
        "POSTGRES_PASSWORD=fixture-only",
        "-e",
        "POSTGRES_DB=fixture",
        "-p",
        `127.0.0.1:${hostPort}:5432`,
        "postgres:18.4@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636",
      ],
      { stdio: "pipe" },
    );
    const port = execFileSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" })
        .trim()
        .split(":")
        .at(-1),
      databaseUrl = `postgresql://fixture:fixture-only@127.0.0.1:${port}/fixture`;
    await until(async () => {
      try {
        execFileSync(
          "docker",
          ["exec", container, "pg_isready", "-U", "fixture", "-d", "fixture"],
          { stdio: "pipe" },
        );
        return true;
      } catch {
        return false;
      }
    }, Boolean);
    await until(async () => {
      const client = new pg.Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 1000,
      });
      try {
        await client.connect();
        await client.query("select 1");
        return true;
      } catch {
        return false;
      } finally {
        await client.end();
      }
    }, Boolean);
    await migrate(databaseUrl);
    const setup = await createApplication({
      databaseUrl,
      stateDirectory: state,
      sessionKey: "process-conformance-signing-key-32-characters",
      deploymentId: "process-conformance",
    });
    const email = "process@example.test",
      password = "process-conformance-password",
      org = (
        await setup.access.bootstrap({
          email,
          password,
          name: "Owner",
          organizationName: "Restart conformance",
        })
      ).organizationId;
    await setup.close();
    await new Promise<void>((resolve) => github.listen(0, "127.0.0.1", resolve));
    const address = github.address();
    if (!address || typeof address === "string") throw new Error("Fixture address");
    const env = {
      ...process.env,
      TEST_DATABASE_URL: databaseUrl,
      TEST_STATE_DIRECTORY: state,
      TEST_GITHUB_URL: `http://127.0.0.1:${address.port}`,
    };
    let base = "",
      token = "";
    async function start(mode: "api" | "worker") {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "tests/fixtures/control-plane.ts", mode],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "",
        errors = "";
      child.stdout?.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        errors += String(chunk).slice(0, 2000);
      });
      await until(
        async () => {
          if (child.exitCode !== null) throw new Error(`Fixture process exited: ${errors}`);
          return output;
        },
        (value) => (mode === "api" ? /API_PORT=\d+/.test(value) : value.includes("WORKER_READY")),
      );
      if (mode === "api") base = `http://127.0.0.1:${output.match(/API_PORT=(\d+)/)?.[1]}`;
      return child;
    }
    async function call(path: string, body?: unknown, key: string = randomUUID()) {
      const response = await fetch(`${base}/api/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          "X-Organization-Id": org,
          Authorization: `Bearer ${token}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
      return data;
    }
    api = await start("api");
    worker = await start("worker");
    token = (await call("/auth/login", { email, password })).token;
    const project = await call("/projects", { name: "Restart journey" }),
      repository = await call(`/projects/${project.id}/repositories`, {
        owner: "fixture",
        name: "process",
      });
    const contract = {
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
      package: { id: "fixture/restart", version: "1.0.0" },
      inputs: {},
      outputs: {},
      dependencies: { confirm: { ...contract, digest: digest(contract) } },
      runtimeSlots: {},
      permissions: [],
      policy: {
        maxInvocations: 10,
        maxConcurrency: 2,
        maxExpressionDepth: 32,
        maxExpressionNodes: 1000,
        referencedSpecChange: "pause_and_replan",
      },
      body: {
        type: "sequence",
        id: "journey",
        children: [
          {
            type: "repeat",
            id: "rounds",
            maxIterations: 2,
            initial: { literal: 0 },
            body: {
              type: "parallel",
              id: "review",
              join: "all",
              maxConcurrency: 2,
              branches: [
                {
                  type: "forEach",
                  id: "approvals",
                  maxItems: 2,
                  maxConcurrency: 2,
                  key: "/id",
                  items: { literal: [{ id: "first" }, { id: "second" }] },
                  body: {
                    type: "call",
                    id: "confirm",
                    action: "confirm",
                    with: { ref: { source: "item", pointer: "" } },
                  },
                  output: { ref: { source: "confirm", pointer: "" } },
                },
                {
                  type: "choose",
                  id: "choice",
                  cases: [
                    {
                      when: { exists: { source: "input", pointer: "/missing" } },
                      // biome-ignore lint/suspicious/noThenProperty: The grammar field holds a node, never a promise callback.
                      then: {
                        type: "sequence",
                        id: "unexpected",
                        children: [],
                        output: { literal: false },
                        outputSchema: { type: "boolean" },
                      },
                    },
                  ],
                  otherwise: {
                    type: "sequence",
                    id: "chosen",
                    children: [],
                    output: { literal: true },
                    outputSchema: { type: "boolean" },
                  },
                },
              ],
            },
            until: {
              eq: [{ ref: { source: "body", pointer: "/approvals/0" } }, { literal: true }],
            },
            carry: { literal: 1 },
            output: { ref: { source: "body", pointer: "" } },
          },
          { type: "end", id: "done", result: { ref: { source: "rounds", pointer: "" } } },
        ],
      },
    };
    const draft = await call("/catalog/playbooks", { title: "Restart fixture", definition }),
      candidate = await call(`/collaboration/catalog/${draft.id}/candidates`, {
        epoch: draft.data.epoch,
        expectedSequence: 0,
      }),
      version = await call(`/catalog/playbooks/${draft.id}/publish`, {
        candidateId: candidate.id,
        expectedHead: 0,
      });
    const operationId = randomUUID(),
      request = {
        projectId: project.id,
        repositoryId: repository.id,
        versionId: version.id,
        sourceCommit: sha,
        inputs: {},
        runtimeBindings: {},
      },
      run = await call("/runs", request, operationId);
    const pending = await until(
      async () =>
        (await call("/requests")).items as {
          id: string;
          version: number;
          data: { runId: string; status: string; manifestDigest: string };
        }[],
      (items) =>
        items.filter((row) => row.data.runId === run.id && row.data.status === "pending").length ===
        2,
    );
    const before = await call(`/runs/${run.id}`),
      decisions = pending.filter((row) => row.data.runId === run.id);
    const responseKey = randomUUID();
    const answer = {
      expectedVersion: decisions[0].version,
      manifestDigest: decisions[0].data.manifestDigest,
      response: true,
      reason: "Exact request reviewed before crash",
    };
    const accepted = await call(`/requests/${decisions[0].id}/respond`, answer, responseKey);
    await stop(worker);
    await stop(api);
    execFileSync("docker", ["restart", container], { stdio: "pipe" });
    await until(async () => {
      try {
        execFileSync(
          "docker",
          ["exec", container, "pg_isready", "-U", "fixture", "-d", "fixture"],
          { stdio: "pipe" },
        );
        return true;
      } catch {
        return false;
      }
    }, Boolean);
    await until(async () => {
      const client = new pg.Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 1000,
      });
      try {
        await client.connect();
        await client.query("select 1");
        return true;
      } catch {
        return false;
      } finally {
        await client.end();
      }
    }, Boolean);
    api = await start("api");
    worker = await start("worker");
    expect(await call(`/requests/${decisions[0].id}/respond`, answer, responseKey)).toEqual(
      accepted,
    );
    expect((await call("/runs", request, operationId)).id).toBe(run.id);
    await call(`/requests/${decisions[1].id}/respond`, {
      expectedVersion: decisions[1].version,
      manifestDigest: decisions[1].data.manifestDigest,
      response: true,
      reason: "Exact remaining request reviewed after restart",
    });
    const completed = await until(
      () => call(`/runs/${run.id}`),
      (value) => value.data.status === "completed",
    );
    expect(completed.data.manifest.digest).toBe(before.data.manifest.digest);
    expect(completed.data.engine.consumed).toBe(2);
    expect(completed.data.engine.output).toEqual({ approvals: [true, true], choice: true });
  } finally {
    await stop(worker);
    await stop(api);
    await new Promise<void>((resolve) => github.close(() => resolve()));
    try {
      execFileSync("docker", ["rm", "--force", container], { stdio: "pipe" });
    } catch {}
    await rm(state, { recursive: true, force: true });
  }
}, 120000);
