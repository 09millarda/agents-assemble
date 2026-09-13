import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRunnerTlsServer, RunnerCertificateAuthority } from "../../../apps/api/src/tls.ts";
import { RunnerJournal } from "../src/journal.ts";
import {
  launchAuthorizationRequestSchema,
  PROTOCOL_VERSION,
  payloadDigest,
  type RunnerCommand,
  type RunnerReceipt,
  reconcileRequestSchema,
} from "../src/protocol.ts";
import { makeCommand } from "./support.ts";

const exec = promisify(execFile);
async function eventually(
  condition: () => boolean | Promise<boolean>,
  timeout = 12000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("condition_timeout");
}

describe("daemon process transport conformance", () => {
  let directory: string,
    runnerDirectory: string,
    server: Server,
    startCounter: string,
    command: RunnerCommand;
  const receipts: RunnerReceipt[] = [];
  let ready = false,
    launchAllowed = true,
    denyAfter = Number.POSITIVE_INFINITY;
  const launchDecisions: string[] = [];
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "aa-daemon-"));
    runnerDirectory = join(directory, "runner");
    await mkdir(runnerDirectory);
    const authority = new RunnerCertificateAuthority(join(directory, "server"));
    await authority.initialize();
    const runnerId = randomUUID(),
      organizationId = randomUUID(),
      key = join(runnerDirectory, "key.pem"),
      csr = join(runnerDirectory, "request.pem");
    await exec("openssl", [
      "req",
      "-new",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-keyout",
      key,
      "-out",
      csr,
      "-subj",
      "/CN=local",
    ]);
    const issued = await authority.sign(await readFile(csr, "utf8"), runnerId, organizationId);
    const cert = join(runnerDirectory, "cert.pem");
    await writeFile(cert, issued.certificatePem, { mode: 0o600 });
    const journal = new RunnerJournal(join(runnerDirectory, "journal"));
    const journalId = journal.journalId;
    journal.close();
    const app = new Hono();
    app.post("/api/v1/runner/authorize-launch", async (context) => {
      const peer = (context.env as { runnerPeer?: { runnerId: string } })?.runnerPeer;
      if (peer?.runnerId !== runnerId) return context.json({ error: "unauthorized" }, 401);
      const request = launchAuthorizationRequestSchema.parse(await context.req.json());
      if (
        !launchAllowed ||
        launchDecisions.filter((id) => id === request.commandId).length >= denyAfter ||
        request.commandId !== command.commandId ||
        request.payloadDigest !== command.payloadDigest
      )
        return context.json({ error: "launch_denied" }, 403);
      launchDecisions.push(request.commandId);
      const now = Date.now();
      return context.json({
        authorized: true,
        commandId: request.commandId,
        scope: request.scope,
        payloadDigest: request.payloadDigest,
        serverTime: new Date(now).toISOString(),
        expiresAt: new Date(now + 5000).toISOString(),
      });
    });
    app.post("/api/v1/runner/reconcile", async (context) => {
      const peer = (context.env as { runnerPeer?: { runnerId: string } })?.runnerPeer;
      if (peer?.runnerId !== runnerId) return context.json({ error: "unauthorized" }, 401);
      const request = reconcileRequestSchema.parse(await context.req.json());
      for (const receipt of request.receipts)
        if (!receipts.some((prior) => prior.receiptId === receipt.receiptId))
          receipts.push(receipt);
      return context.json({
        version: PROTOCOL_VERSION,
        serverTime: new Date().toISOString(),
        revoked: false,
        commands: ready ? [command] : [],
        acceptedReceiptIds: request.receipts.map((receipt) => receipt.receiptId),
      });
    });
    server = await createRunnerTlsServer(app, authority);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing_address");
    const remote = join(directory, "upstream.git"),
      source = join(directory, "source");
    await exec("git", ["init", "--bare", remote]);
    await exec("git", ["clone", remote, source]);
    await writeFile(join(source, "README.md"), "A baseline\n");
    await exec("git", ["add", "."], { cwd: source });
    await exec(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "baseline"],
      { cwd: source },
    );
    await exec("git", ["push", "origin", "HEAD"], { cwd: source });
    const baseline = (await exec("git", ["rev-parse", "HEAD"], { cwd: source })).stdout.trim();
    startCounter = join(directory, "native-starts");
    const fake = join(directory, "codex");
    await writeFile(
      fake,
      `#!/usr/bin/env node\nconst fs=require('node:fs');if(process.argv.includes('--version')){console.log('codex-cli 0.153.4');process.exit(0)}\nrequire('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;let result={};if(r.method==='account/read')result={account:{type:'chatgpt'},requiresOpenaiAuth:true};if(r.method==='model/list')result={data:[{id:'example-model',model:'example-model',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]};if(r.method==='thread/start')result={thread:{id:'thread-1'},model:'example-model',modelProvider:'openai',reasoningEffort:'medium',sandbox:{type:'workspaceWrite',networkAccess:false}};if(r.method==='turn/start'){fs.appendFileSync(${JSON.stringify(startCounter)},'start\\n');result={turn:{id:'turn-1'}}}if(r.method==='turn/steer')fs.appendFileSync(${JSON.stringify(join(directory, "native-inputs"))},r.params.clientUserMessageId+'\\n');console.log(JSON.stringify({id:r.id,result}));});\n`,
      { mode: 0o700 },
    );
    await writeFile(
      join(runnerDirectory, "config.json"),
      JSON.stringify({
        version: PROTOCOL_VERSION,
        serviceUrl: `https://127.0.0.1:${address.port}`,
        runnerId,
        organizationId,
        deploymentId: "deployment-1",
        journalId,
        credentialGeneration: 1,
        expiresAt: issued.expiresAt,
        caFile: join(authority.directory, "ca.pem"),
        certificateFile: cert,
        privateKeyFile: key,
        codexBinary: fake,
        pollIntervalMs: 100,
      }),
      { mode: 0o600 },
    );
    const start = makeCommand();
    start.scope = { ...start.scope, runnerId, organizationId, journalId };
    start.payload.repository = { ...start.payload.repository, url: remote, commit: baseline };
    start.payloadDigest = payloadDigest(start.payload);
    start.expiresAt = new Date(Date.now() + 120000).toISOString();
    command = start;
    ready = true;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("does not relaunch after SIGKILL once the native start may have succeeded", async () => {
    const cli = resolve("apps/runner/src/cli.ts");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", cli, "daemon", "run", "--directory", runnerDirectory],
      { stdio: "ignore" },
    );
    try {
      await eventually(() => receipts.some((receipt) => receipt.status === "running"));
      expect(
        launchDecisions.filter((id) => id === command.commandId).length,
      ).toBeGreaterThanOrEqual(5);
      expect((await readFile(startCounter, "utf8")).trim().split("\n")).toHaveLength(1);
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      await exec(
        process.execPath,
        ["--import", "tsx", cli, "daemon", "run", "--once", "--directory", runnerDirectory],
        { timeout: 15000 },
      );
      expect((await readFile(startCounter, "utf8")).trim().split("\n")).toHaveLength(1);
      expect(receipts.filter((receipt) => receipt.status === "outcome_unknown")).toContainEqual(
        expect.objectContaining({
          details: expect.objectContaining({
            reason: "daemon_restart",
            writerCoverage: "incomplete",
          }),
        }),
      );
      const status = await exec(process.execPath, [
        "--import",
        "tsx",
        cli,
        "status",
        "--directory",
        runnerDirectory,
      ]);
      expect(JSON.parse(status.stdout).attempts[0].stage).toBe("outcome_unknown");
    } finally {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
    }
  });
  it("preserves accepted command bytes when a replay tries to substitute its payload", async () => {
    if (command.kind !== "start") throw new Error("unexpected_command");
    command = { ...command, payload: { ...command.payload, prompt: "different payload" } };
    command.payloadDigest = payloadDigest(command.payload);
    await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/runner/src/cli.ts"),
        "daemon",
        "run",
        "--once",
        "--directory",
        runnerDirectory,
      ],
      { timeout: 15000 },
    );
    expect((await readFile(startCounter, "utf8")).trim().split("\n")).toHaveLength(1);
    expect(existsSync(join(directory, "native-inputs"))).toBe(false);
  });
  it("refuses a fresh native command before creating its workspace when launch authority is denied", async () => {
    const original = command;
    command = {
      ...original,
      commandId: randomUUID(),
      scope: {
        ...original.scope,
        invocationId: randomUUID(),
        assignmentId: randomUUID(),
        attemptId: randomUUID(),
      },
    };
    launchAllowed = false;
    await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/runner/src/cli.ts"),
        "daemon",
        "run",
        "--once",
        "--directory",
        runnerDirectory,
      ],
      { timeout: 15000 },
    );
    const journal = new RunnerJournal(join(runnerDirectory, "journal"));
    try {
      expect(journal.receive(command).state.stage).toBe("rejected");
      expect(receipts).toContainEqual(
        expect.objectContaining({
          commandId: command.commandId,
          status: "rejected",
          details: { reason: "launch_authority_unavailable" },
        }),
      );
    } finally {
      journal.close();
    }
    expect((await readFile(startCounter, "utf8")).trim().split("\n")).toHaveLength(1);
    expect(existsSync(join(runnerDirectory, "workspaces", command.scope.invocationId))).toBe(false);
  });
  it("rechecks a newly imposed hold after repository preparation before starting native work", async () => {
    command = {
      ...command,
      commandId: randomUUID(),
      scope: {
        ...command.scope,
        invocationId: randomUUID(),
        assignmentId: randomUUID(),
        attemptId: randomUUID(),
      },
    };
    launchAllowed = true;
    denyAfter = 2;
    await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/runner/src/cli.ts"),
        "daemon",
        "run",
        "--once",
        "--directory",
        runnerDirectory,
      ],
      { timeout: 15000 },
    );
    expect(launchDecisions.filter((id) => id === command.commandId)).toHaveLength(2);
    expect(
      existsSync(join(runnerDirectory, "workspaces", command.scope.invocationId, "worktree")),
    ).toBe(true);
    expect((await readFile(startCounter, "utf8")).trim().split("\n")).toHaveLength(1);
    expect(receipts).toContainEqual(
      expect.objectContaining({
        commandId: command.commandId,
        status: "outcome_unknown",
        details: expect.objectContaining({ writerCoverage: "incomplete" }),
      }),
    );
  });
});
