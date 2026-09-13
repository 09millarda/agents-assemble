import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import type { Server } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { type Definition, digest } from "@aa/catalog/definition";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import { GithubRepositories } from "../../apps/api/src/projects.ts";
import { createRunnerTlsServer, RunnerCertificateAuthority } from "../../apps/api/src/tls.ts";
import { Worker } from "../../apps/worker/src/worker.ts";
import { doctor } from "../../packages/runner/src/native.ts";
import {
  artifactRefSchema,
  checkpointRefSchema,
  launchAuthorizationResponseSchema,
  PROTOCOL_VERSION,
  type RunnerCommand,
  type RunnerReceipt,
  reconcileResponseSchema,
} from "../../packages/runner/src/protocol.ts";
import { RunnerTransport, runnerConfigSchema } from "../../packages/runner/src/transport.ts";
import { migrate } from "../../scripts/migrate.ts";

const exec = promisify(execFile),
  databaseUrl =
    process.env.TEST_DATABASE_URL ??
    "postgresql://agents_assemble:local-development-only@127.0.0.1:55433/agents_assemble_test";
const isolatedDatabase = new URL(databaseUrl);
isolatedDatabase.pathname = `/aa_question_${randomUUID().replaceAll("-", "")}`;
async function databaseLifecycle(create: boolean) {
  const maintenance = new URL(databaseUrl);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const name = isolatedDatabase.pathname.slice(1);
    if (!/^aa_question_[a-f0-9]{32}$/.test(name)) throw new Error("invalid_fixture_database");
    await client.query(
      create ? `CREATE DATABASE "${name}"` : `DROP DATABASE "${name}" WITH (FORCE)`,
    );
  } finally {
    await client.end();
  }
}
const sha = "a".repeat(40),
  email = `question-${randomUUID()}@example.test`;
let directory: string,
  app: Application,
  worker: Worker,
  github: HttpServer,
  tls: Server,
  transport: RunnerTransport,
  token: string,
  org: string,
  projectId: string,
  repositoryId: string,
  runtimeId: string,
  environmentId: string,
  environmentDigest: string,
  runnerId: string,
  journalId: string,
  versionId: string;
let counter = 0,
  capabilities: Awaited<ReturnType<typeof doctor>>;
const call = async (path: string, body?: unknown, key: string = randomUUID()) => {
  const response = await app.router.app.request(`http://localhost/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Organization-Id": org,
      "Idempotency-Key": key,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
};
async function settle() {
  for (let index = 0; index < 4; index++) await worker.once();
}
async function reconcile(receipts: RunnerReceipt[] = []) {
  return reconcileResponseSchema.parse(
    await transport.post("/api/v1/runner/reconcile", {
      version: PROTOCOL_VERSION,
      runnerId,
      journalId,
      sequence: ++counter,
      capabilities,
      receipts,
    }),
  );
}
function receipt(
  command: RunnerCommand,
  status: RunnerReceipt["status"],
  details: Record<string, unknown> = {},
): RunnerReceipt {
  return {
    receiptId: randomUUID(),
    commandId: command.commandId,
    scope: command.scope,
    sequence: ++counter,
    status,
    details,
    createdAt: new Date().toISOString(),
  };
}
const config = () => ({
  databaseUrl: isolatedDatabase.toString(),
  sessionKey: "question-session-key-at-least-32-characters",
  deploymentId: "question-tests",
  stateDirectory: join(directory, "control-plane"),
  repositories: new GithubRepositories(
    undefined,
    `http://127.0.0.1:${(github.address() as { port: number }).port}`,
  ),
  githubApiBase: `http://127.0.0.1:${(github.address() as { port: number }).port}`,
});
async function publish(adapter: string) {
  const action = {
    id: `test/${adapter}`,
    version: "1.0.0",
    kind: "agent" as const,
    executor: "runner" as const,
    adapter,
    adapterVersion: "1.0.0",
    inputs: {},
    outputs: {},
    effect: "read" as const,
    permissions: [],
    capabilities: [],
    retry: { maxAttempts: 1, safeErrorClasses: [] },
    timeoutSeconds: 300,
    cancellation: "reconcile" as const,
  };
  const definition: Definition = {
    formatVersion: "agents-assemble.playbook/1",
    package: { id: `test/question-${randomUUID()}`, version: "1.0.0" },
    inputs: {},
    outputs: {},
    dependencies: { work: { ...action, digest: digest(action) } },
    runtimeSlots: { worker: { harness: "codex", capabilities: [] } },
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
          id: "work",
          type: "call",
          action: "work",
          runtime: "worker",
          with: { ref: { source: "input", pointer: "" } },
        },
        { id: "done", type: "end", result: { ref: { source: "work", pointer: "" } } },
      ],
    },
  };
  const draft = await call("/catalog/playbooks", { title: adapter, definition });
  expect(draft.status, JSON.stringify(draft.data)).toBe(200);
  const candidate = await call(`/collaboration/catalog/${draft.data.id}/candidates`, {
    epoch: draft.data.data.epoch,
    expectedSequence: 0,
  });
  expect(candidate.status).toBe(200);
  const published = await call(`/catalog/playbooks/${draft.data.id}/publish`, {
    candidateId: candidate.data.id,
    expectedHead: 0,
  });
  expect(published.status).toBe(200);
  return published.data.id as string;
}
async function start(inputs: unknown = {}, version = versionId) {
  await reconcile();
  const run = await call("/runs", {
    projectId,
    repositoryId,
    versionId: version,
    sourceCommit: sha,
    inputs,
    runtimeBindings: { worker: runtimeId },
    environmentProfileId: environmentId,
  });
  expect(run.status, JSON.stringify(run.data)).toBe(200);
  await settle();
  const response = await reconcile(),
    command = response.commands.find((command) => command.scope.runId === run.data.id);
  expect(command, (await call(`/runs/${run.data.id}`)).data.data.reason).toBeDefined();
  if (!command) throw new Error("missing_assignment");
  const pinnedEnvironment = {
    profileId: environmentId,
    revision: environmentDigest,
    resolverPolicy: "local-file",
    rotationPolicy: "refresh_per_attempt",
    variables: {},
    secretBindings: [],
  };
  const admitted = await call(`/runs/${run.data.id}`);
  expect(admitted.status).toBe(200);
  expect(admitted.data.data.manifest.environment).toEqual(pinnedEnvironment);
  expect(command.payload).toMatchObject({ environment: pinnedEnvironment });
  const launch = {
    version: PROTOCOL_VERSION,
    commandId: command.commandId,
    scope: command.scope,
    payloadDigest: command.payloadDigest,
  };
  for (let index = 0; index < 2; index++) {
    const decision = launchAuthorizationResponseSchema.parse(
      await transport.post("/api/v1/runner/authorize-launch", launch),
    );
    expect(decision).toMatchObject({
      authorized: true,
      commandId: command.commandId,
      scope: command.scope,
      payloadDigest: command.payloadDigest,
    });
    expect(Date.parse(decision.expiresAt) - Date.parse(decision.serverTime)).toBeGreaterThan(0);
    expect(Date.parse(decision.expiresAt) - Date.parse(decision.serverTime)).toBeLessThanOrEqual(
      5000,
    );
  }
  await reconcile([receipt(command, "running", { threadId: "thread-1", turnId: "turn-1" })]);
  return { id: run.data.id as string, command };
}
beforeAll(async () => {
  await databaseLifecycle(true);
  await migrate(isolatedDatabase.toString());
  directory = await mkdtemp(join(tmpdir(), "aa-question-http-"));
  github = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url?.includes("/commits/")
          ? { sha }
          : {
              id: 555,
              owner: { id: 666, login: "fixture" },
              name: "repo",
              clone_url: "https://github.com/fixture/repo.git",
              default_branch: "main",
            },
      ),
    );
  });
  await new Promise<void>((resolve) => github.listen(0, "127.0.0.1", resolve));
  app = await createApplication(config());
  worker = new Worker(app);
  org = (
    await app.access.bootstrap({
      email,
      name: "Owner",
      password: "a-long-question-test-password",
      organizationName: "Questions",
    })
  ).organizationId;
  token = (await call("/auth/login", { email, password: "a-long-question-test-password" })).data
    .token;
  const project = await call("/projects", { name: "Native questions" });
  projectId = project.data.id;
  repositoryId = (
    await call(`/projects/${projectId}/repositories`, { owner: "fixture", name: "repo" })
  ).data.id;
  const profile = await call("/runtime-profiles", {
    name: "Question fixture",
    harness: "codex",
    model: "example-model",
    effort: "medium",
    sandbox: "read-only",
    trustedRunner: true,
    codexVersion: "0.153.4",
    capabilities: [],
  });
  expect(profile.status).toBe(200);
  runtimeId = profile.data.id;
  const environment = await call("/environments", {
    name: "Fixture",
    variables: {},
    secretBindings: [],
    resolverPolicy: "local-file",
    rotationPolicy: "refresh_per_attempt",
  });
  expect(environment.status).toBe(200);
  environmentId = environment.data.id;
  environmentDigest = environment.data.data.digest;
  expect(
    (
      await call(`/projects/${projectId}/policy`, {
        expectedVersion: project.data.version,
        policy: {
          ...project.data.data.policy,
          trustedRunner: true,
          runtimeProfileId: runtimeId,
          environmentProfileId: environmentId,
        },
      })
    ).status,
  ).toBe(200);
  tls = await createRunnerTlsServer(app.router.app, app.fleet.authority);
  await new Promise<void>((resolve) => tls.listen(0, "127.0.0.1", resolve));
  const address = tls.address();
  if (!address || typeof address === "string") throw new Error("missing_address");
  const challenge = await call("/fleet/enrollments", { name: "Public fixture runner" });
  expect(challenge.status).toBe(200);
  runnerId = challenge.data.runnerId;
  const tokenFile = join(directory, "token"),
    binary = join(directory, "codex");
  await writeFile(tokenFile, challenge.data.enrollmentToken, { mode: 0o600 });
  await writeFile(
    binary,
    `#!/usr/bin/env node\nif(process.argv.includes('--version')){console.log('codex-cli 0.153.4');process.exit(0)}require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id!==undefined)console.log(JSON.stringify({id:r.id,result:r.method==='account/read'?{account:{type:'chatgpt'}}:{}}));});\n`,
    { mode: 0o700 },
  );
  const runnerDirectory = join(directory, "runner");
  await exec(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("apps/runner/src/cli.ts"),
      "enroll",
      "--directory",
      runnerDirectory,
      "--service",
      `https://127.0.0.1:${address.port}`,
      "--ca",
      join(app.fleet.authority.directory, "ca.pem"),
      "--token-file",
      tokenFile,
      "--codex",
      binary,
    ],
    { timeout: 15000 },
  );
  const runner = runnerConfigSchema.parse(
    JSON.parse(await readFile(join(runnerDirectory, "config.json"), "utf8")),
  );
  journalId = runner.journalId;
  transport = new RunnerTransport(runner.serviceUrl, runner);
  capabilities = await doctor(binary);
  await reconcile();
  versionId = await publish("ask");
});
afterAll(async () => {
  if (tls) await new Promise<void>((resolve) => tls.close(() => resolve()));
  await app?.close();
  await databaseLifecycle(false);
  if (github) await new Promise<void>((resolve) => github.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
let spec: ReturnType<typeof artifactRefSchema.parse>,
  hiddenSpec: ReturnType<typeof artifactRefSchema.parse>,
  checkpoint: ReturnType<typeof checkpointRefSchema.parse>,
  anotherCheckpoint: ReturnType<typeof checkpointRefSchema.parse>;
it("crosses actual CLI enrollment and mTLS to retain a typed native question, restart the service, answer once and accept verified output", async () => {
  const run = await start();
  spec = artifactRefSchema.parse(
    await transport.post("/api/v1/runner/artifacts", {
      version: PROTOCOL_VERSION,
      operationId: randomUUID(),
      scope: run.command.scope,
      mediaType: "text/markdown",
      content: "The exact accepted specification.",
    }),
  );
  hiddenSpec = artifactRefSchema.parse(
    await transport.post("/api/v1/runner/artifacts", {
      version: PROTOCOL_VERSION,
      operationId: randomUUID(),
      scope: run.command.scope,
      mediaType: "text/markdown",
      content: "Not authorized for the later review inputs.",
    }),
  );
  async function checkpointRef() {
    return checkpointRefSchema.parse(
      await transport.post("/api/v1/runner/checkpoints", {
        version: PROTOCOL_VERSION,
        operationId: randomUUID(),
        scope: run.command.scope,
        checkpoint: {
          version: "aa-checkpoint/1",
          repositoryId: "555",
          repositoryUrl: "https://github.com/fixture/repo.git",
          baseline: sha,
          commit: sha,
          tree: "b".repeat(40),
          ref: `refs/agents-assemble/checkpoints/${run.command.scope.invocationId}/${randomUUID()}`,
          invocationId: run.command.scope.invocationId,
          inputDigest: run.command.scope.inputDigest,
          manifestDigest: run.command.payloadDigest,
          scope: run.command.scope,
          verifiedAt: new Date().toISOString(),
        },
      }),
    );
  }
  checkpoint = await checkpointRef();
  anotherCheckpoint = await checkpointRef();
  const question = {
    requestId: "native-request-42",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    questions: [
      {
        id: "direction",
        header: "Direction",
        question: "Which direction?",
        isOther: false,
        isSecret: false,
        options: [
          { label: "Left", description: "Left path" },
          { label: "Right", description: "Right path" },
        ],
      },
    ],
    isBlocking: true,
    autoResolutionMs: null,
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  };
  const requestReceipt = receipt(run.command, "question", question);
  await reconcile([requestReceipt]);
  await reconcile([requestReceipt]);
  await settle();
  let requests = (await call("/requests")).data.items.filter(
    (item: { data: { runId: string } }) => item.data.runId === run.id,
  );
  expect(requests).toHaveLength(1);
  const human = requests[0];
  const address = tls.address();
  if (!address || typeof address === "string") throw new Error("missing_address");
  await new Promise<void>((resolve) => tls.close(() => resolve()));
  await app.close();
  app = await createApplication(config());
  worker = new Worker(app);
  tls = await createRunnerTlsServer(app.router.app, app.fleet.authority);
  await new Promise<void>((resolve) => tls.listen(address.port, "127.0.0.1", resolve));
  requests = (await call("/requests")).data.items.filter(
    (item: { data: { runId: string } }) => item.data.runId === run.id,
  );
  expect(requests[0].id).toBe(human.id);
  const response = {
    expectedVersion: human.version,
    manifestDigest: human.data.manifestDigest,
    response: { answers: { direction: { answers: ["Left"] } } },
    reason: "Reviewed exact request",
  };
  expect(
    (
      await call(`/requests/${human.id}/respond`, {
        ...response,
        response: { answers: { direction: { answers: ["Unlisted"] } } },
      })
    ).status,
  ).toBe(400);
  const key = randomUUID();
  expect((await call(`/requests/${human.id}/respond`, response, key)).status).toBe(200);
  expect((await call(`/requests/${human.id}/respond`, response, key)).status).toBe(200);
  await settle();
  const answer = (await reconcile()).commands.find((command) => command.kind === "answer");
  expect(answer).toMatchObject({
    kind: "answer",
    scope: run.command.scope,
    payload: {
      requestId: question.requestId,
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      response: response.response,
    },
  });
  if (!answer) throw new Error("answer_not_dispatched");
  expect(
    (await reconcile()).commands
      .filter((command) => command.kind === "answer")
      .map((command) => command.commandId),
  ).toEqual([answer.commandId]);
  await reconcile([
    receipt(answer, "delivered", {
      requestId: question.requestId,
      itemId: "item-1",
      threadId: "thread-1",
      turnId: "turn-1",
    }),
  ]);
  expect(Object.keys((await call(`/runs/${run.id}`)).data.data.holds)).toEqual([]);
  await reconcile([receipt(run.command, "completed", { output: { spec, checkpoint } })]);
  await settle();
  expect((await call(`/runs/${run.id}`)).data.data.status).toBe("completed");
  await reconcile([
    receipt(run.command, "failed", { reason: "late_lifecycle" }),
    receipt(run.command, "observation", { writerCoverage: "incomplete" }),
  ]);
  expect((await call(`/runs/${run.id}`)).data.data.status).toBe("completed");
}, 60000);
it("rejects forged immutable references and a valid but different reviewed checkpoint; subsequent held results remain accounting only", async () => {
  const reviewVersion = await publish("review"),
    run = await start({ spec, checkpoint }, reviewVersion);
  const read = {
    version: PROTOCOL_VERSION,
    operationId: randomUUID(),
    scope: run.command.scope,
    reference: spec,
  };
  expect(await transport.post("/api/v1/runner/artifacts/read", read)).toEqual({
    reference: spec,
    content: "The exact accepted specification.",
  });
  await expect(
    transport.post("/api/v1/runner/artifacts/read", {
      ...read,
      operationId: randomUUID(),
      reference: hiddenSpec,
    }),
  ).rejects.toThrow("runner_http_403");
  const forged = { ...spec, id: randomUUID(), revisionId: randomUUID() };
  await reconcile([
    receipt(run.command, "completed", { output: { accepted: true, spec: forged, checkpoint } }),
  ]);
  expect(Object.values((await call(`/runs/${run.id}`)).data.data.holds)).toContainEqual(
    expect.objectContaining({ reason: expect.stringContaining("immutable") }),
  );
  await reconcile([
    receipt(run.command, "completed", {
      output: { accepted: true, spec, checkpoint: anotherCheckpoint },
    }),
  ]);
  expect(Object.values((await call(`/runs/${run.id}`)).data.data.holds)).toContainEqual(
    expect.objectContaining({ reason: expect.stringContaining("exact assigned") }),
  );
  await reconcile([
    receipt(run.command, "completed", { output: { accepted: true, spec, checkpoint } }),
  ]);
  await settle();
  const current = (await call(`/runs/${run.id}`)).data.data;
  expect(current.status).toBe("blocked");
  expect(
    Object.values(current.engine.nodes).find(
      (node: unknown) =>
        !!node &&
        typeof node === "object" &&
        "invocationId" in node &&
        node.invocationId === run.command.scope.invocationId,
    ),
  ).toEqual(expect.not.objectContaining({ status: "completed" }));
  const retained = (await call(`/runs/${run.id}`)).data;
  const recovery = await call(`/runs/${run.id}/recovery`, {
    expectedVersion: retained.version,
    reason: "Inspect incomplete writer coverage",
    action: "resume",
  });
  expect(recovery.status).toBe(200);
  expect(recovery.data).toMatchObject({
    status: "blocked",
    runId: run.id,
    reason: expect.stringContaining("command was issued"),
  });
});
it("reconstructs only a never-issued run from its verified baseline through a fresh admission", async () => {
  await reconcile();
  const pending = await call("/runs", {
    projectId,
    repositoryId,
    versionId,
    sourceCommit: sha,
    inputs: { checkpoint },
    runtimeBindings: { worker: runtimeId },
    environmentProfileId: environmentId,
  });
  expect(pending.status).toBe(200);
  await settle();
  const prior = (await call(`/runs/${pending.data.id}`)).data;
  expect(prior.data.admissionVerdict).toBe("admitted");
  expect((await reconcile()).commands.some((command) => command.scope.runId === prior.id)).toBe(
    false,
  );
  const inspect = {
    expectedVersion: prior.version,
    reason: "Recover work that never reached a runner",
    action: "inspect",
  };
  expect((await call(`/runs/${prior.id}/recovery`, inspect)).data.status).toBe("blocked");
  const challenge = await call("/fleet/enrollments", { name: "Fresh recovery runner" });
  const tokenFile = join(directory, "recovery-token"),
    runnerDirectory = join(directory, "recovery-runner");
  await writeFile(tokenFile, challenge.data.enrollmentToken, { mode: 0o600 });
  const address = tls.address();
  if (!address || typeof address === "string") throw new Error("missing_address");
  await exec(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("apps/runner/src/cli.ts"),
      "enroll",
      "--directory",
      runnerDirectory,
      "--service",
      `https://127.0.0.1:${address.port}`,
      "--ca",
      join(app.fleet.authority.directory, "ca.pem"),
      "--token-file",
      tokenFile,
      "--codex",
      join(directory, "codex"),
    ],
    { timeout: 15000 },
  );
  const runner = runnerConfigSchema.parse(
    JSON.parse(await readFile(join(runnerDirectory, "config.json"), "utf8")),
  );
  const fresh = new RunnerTransport(runner.serviceUrl, runner);
  const heartbeat = {
    version: PROTOCOL_VERSION,
    runnerId: runner.runnerId,
    journalId: runner.journalId,
    sequence: 1,
    capabilities,
    receipts: [],
  };
  await fresh.post("/api/v1/runner/reconcile", heartbeat);
  expect((await call(`/runs/${prior.id}/recovery`, inspect)).data.status).toBe("eligible");
  const key = randomUUID(),
    resume = { ...inspect, action: "resume" };
  const recovered = await call(`/runs/${prior.id}/recovery`, resume, key);
  expect(recovered.status, JSON.stringify(recovered.data)).toBe(200);
  expect(recovered.data.status).toBe("reconstructed");
  expect((await call(`/runs/${prior.id}/recovery`, resume, key)).data).toEqual(recovered.data);
  const predecessor = (await call(`/runs/${prior.id}`)).data.data;
  expect(predecessor).toMatchObject({
    status: "superseded",
    successorId: recovered.data.successorId,
    manifest: prior.data.manifest,
  });
  expect(Object.keys(predecessor.holds)).toContain(`reconstruction:${recovered.data.successorId}`);
  await settle();
  const successor = (await call(`/runs/${recovered.data.successorId}`)).data;
  expect(successor.data).toMatchObject({
    predecessorId: prior.id,
    admissionVerdict: "admitted",
    request: prior.data.request,
  });
  expect(successor.data.manifest.permit.id).not.toBe(prior.data.manifest.permit.id);
  const commands = reconcileResponseSchema.parse(
    await fresh.post("/api/v1/runner/reconcile", { ...heartbeat, sequence: 2 }),
  ).commands;
  expect(commands.some((command) => command.scope.runId === prior.id)).toBe(false);
  expect(commands.some((command) => command.scope.runId === successor.id)).toBe(true);
});
it("atomically publishes one matching CA under concurrent API and worker initialization", async () => {
  const state = join(directory, "concurrent-pki");
  const authorities = Array.from({ length: 4 }, () => new RunnerCertificateAuthority(state));
  await Promise.all(authorities.map((authority) => authority.initialize()));
  const certificates = await Promise.all(authorities.map((authority) => authority.caPem()));
  expect(new Set(certificates).size).toBe(1);
});
