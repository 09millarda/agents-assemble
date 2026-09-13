import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import type { Server as TlsServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { type Definition, digest } from "@aa/catalog/definition";
import { artifactSchema, checkpointSchema } from "@aa/catalog/starters";
import { envelope } from "@aa/platform/http";
import { serve } from "@hono/node-server";
import { expect, it } from "vitest";
import { z } from "zod";
import { type Application, createApplication } from "../../apps/api/src/app.ts";
import { humanRequestSchema } from "../../apps/api/src/human.ts";
import { GithubRepositories, projectSchema } from "../../apps/api/src/projects.ts";
import { createRunnerTlsServer } from "../../apps/api/src/tls.ts";
import { Worker } from "../../apps/worker/src/worker.ts";
import {
  artifactRefSchema,
  checkpointRefSchema,
  nativeQuestionSchema,
} from "../../packages/runner/src/protocol.ts";
import { isolatedDatabase } from "../fixtures/database.ts";

const exec = promisify(execFile);
const row = envelope(z.unknown());
const draftRow = envelope(z.object({ epoch: z.uuid() }).passthrough());
const artifactOutput = z.strictObject({
  answer: z.literal("Blue"),
  marker: z.string().min(1),
  brief: artifactRefSchema,
  evidence: artifactRefSchema,
  checkpoint: checkpointRefSchema,
});
const runRow = envelope(
  z
    .object({
      status: z.string(),
      reason: z.string(),
      holds: z.record(z.string(), z.unknown()),
      engine: z.object({ output: z.unknown().optional() }).passthrough(),
    })
    .passthrough(),
);

it.skipIf(process.env.AA_NATIVE_JOURNEY !== "1")(
  "crosses real CLI, mTLS, native Codex, durable human reply and immutable Git/artifact acceptance across an API restart",
  async () => {
    const model = process.env.AA_NATIVE_MODEL,
      effort = process.env.AA_NATIVE_EFFORT;
    if (!model || effort !== "low")
      throw new Error(
        "Select a verified AA_NATIVE_MODEL and AA_NATIVE_EFFORT=low; this qualification never substitutes models or credentials",
      );
    const db = isolatedDatabase(),
      directory = await mkdtemp(join(tmpdir(), "aa-native-journey-")),
      marker = `AA_NATIVE_JOURNEY_${randomUUID()}`;
    let api: Application | undefined,
      runnerApp: Application | undefined,
      http: ReturnType<typeof serve> | undefined,
      tls: TlsServer | undefined,
      github: HttpServer | undefined,
      daemon: ChildProcess | undefined,
      worker: Worker | undefined;
    let url = "",
      token = "",
      org = "",
      diagnostic = "";
    const call = async (path: string, body?: unknown, key = randomUUID()): Promise<unknown> => {
      const response = await fetch(`${url}/api/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          "X-Organization-Id": org,
          Authorization: `Bearer ${token}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value: unknown = await response.json();
      expect(response.status, JSON.stringify(value)).toBe(200);
      return value;
    };
    const poll = async <T>(observe: () => Promise<T | undefined>, timeout = 90000): Promise<T> => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        await worker?.once();
        const value = await observe();
        if (value !== undefined) return value;
        if (daemon?.exitCode !== null && daemon?.exitCode !== undefined)
          throw new Error(`native_daemon_exited:${diagnostic}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`native_journey_timeout:${diagnostic}`);
    };
    try {
      await db.create();
      const upstream = join(directory, "upstream.git"),
        source = join(directory, "source");
      await exec("git", ["init", "--bare", "--initial-branch=main", upstream]);
      await exec("git", ["clone", upstream, source]);
      await writeFile(join(source, "README.md"), "Read-only native qualification repository.\n");
      await exec("git", ["add", "README.md"], { cwd: source });
      await exec(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.test",
          "commit",
          "-m",
          "Qualification baseline",
        ],
        { cwd: source },
      );
      await exec("git", ["push", "origin", "HEAD"], { cwd: source });
      const baseline = (await exec("git", ["rev-parse", "HEAD"], { cwd: source })).stdout.trim(),
        repositoryUrl = pathToFileURL(upstream).href;
      github = createServer((request, response) => {
        void (async () => {
          response.setHeader("content-type", "application/json");
          if (request.url?.includes("/commits/")) {
            const ref = decodeURIComponent(request.url.split("/commits/")[1]);
            if (ref !== "main" && !/^[a-f0-9]{40}$/.test(ref)) {
              response.writeHead(404);
              response.end("{}");
              return;
            }
            try {
              const sha = (
                await exec("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: upstream })
              ).stdout.trim();
              response.end(JSON.stringify({ sha }));
            } catch {
              response.writeHead(404);
              response.end("{}");
            }
          } else
            response.end(
              JSON.stringify({
                id: 555,
                owner: { id: 666, login: "fixture" },
                name: "repo",
                clone_url: repositoryUrl,
                default_branch: "main",
              }),
            );
        })().catch(() => {
          response.writeHead(500);
          response.end("{}");
        });
      });
      await new Promise<void>((resolve) => github?.listen(0, "127.0.0.1", resolve));
      const providerAddress = github.address();
      if (!providerAddress || typeof providerAddress === "string")
        throw new Error("fixture_address_missing");
      const providerUrl = `http://127.0.0.1:${providerAddress.port}`;
      const config = {
        databaseUrl: db.url,
        stateDirectory: join(directory, "control-plane"),
        sessionKey: "native-journey-session-key-at-least-32-characters",
        deploymentId: "native-journey",
        repositories: new GithubRepositories(undefined, providerUrl),
        githubApiBase: providerUrl,
      };
      api = await createApplication(config);
      runnerApp = await createApplication(config);
      worker = new Worker(api);
      const email = `journey-${randomUUID()}@example.test`,
        password = "native-journey-fixture-password";
      org = (
        await api.access.bootstrap({
          email,
          password,
          name: "Local qualification",
          organizationName: "Native journey fixture",
        })
      ).organizationId;
      http = serve({ fetch: api.router.app.fetch, hostname: "127.0.0.1", port: 0 });
      await new Promise<void>((resolve) => http?.once("listening", resolve));
      const httpAddress = http.address();
      if (!httpAddress || typeof httpAddress === "string")
        throw new Error("fixture_address_missing");
      url = `http://127.0.0.1:${httpAddress.port}`;
      token = z
        .object({ token: z.string() })
        .parse(await call("/auth/login", { email, password })).token;
      const project = envelope(projectSchema).parse(
        await call("/projects", { name: "Native journey" }),
      );
      const repository = row.parse(
        await call(`/projects/${project.id}/repositories`, { owner: "fixture", name: "repo" }),
      );
      const runtime = row.parse(
        await call("/runtime-profiles", {
          name: "Qualified existing Codex",
          harness: "codex",
          model,
          effort,
          sandbox: "read-only",
          trustedRunner: true,
          codexVersion: "0.153.4",
          capabilities: [],
        }),
      );
      const environment = row.parse(
        await call("/environments", {
          name: "Empty native environment",
          variables: {},
          secretBindings: [],
          resolverPolicy: "local-file",
          rotationPolicy: "refresh_per_attempt",
        }),
      );
      await call(`/projects/${project.id}/policy`, {
        expectedVersion: project.version,
        policy: {
          ...project.data.policy,
          trustedRunner: true,
          runtimeProfileId: runtime.id,
          environmentProfileId: environment.id,
        },
      });
      const briefDraft = draftRow.parse(
        await call("/knowledge/documents", {
          title: "Native fixture brief",
          content: `Fixture marker: ${marker}\n`,
        }),
      );
      const briefCandidate = row.parse(
        await call(`/collaboration/knowledge/${briefDraft.id}/candidates`, {
          epoch: briefDraft.data.epoch,
          expectedSequence: 0,
        }),
      );
      const briefRevision = envelope(z.object({ digest: z.string() }).passthrough()).parse(
        await call(`/collaboration/knowledge/${briefDraft.id}/submit`, {
          candidateId: briefCandidate.id,
          expectedHead: 0,
        }),
      );
      const brief = artifactRefSchema.parse({
        id: briefDraft.id,
        revisionId: briefRevision.id,
        digest: briefRevision.data.digest,
        mediaType: "text/markdown",
      });
      const action = {
        id: "test/nativeJourney",
        version: "1.0.0",
        kind: "agent" as const,
        executor: "runner" as const,
        adapter: "nativeJourney",
        adapterVersion: "1.0.0",
        inputs: {},
        outputs: {
          type: "object",
          properties: {
            answer: { type: "string", enum: ["Blue"] },
            marker: { type: "string" },
            brief: artifactSchema,
            evidence: artifactSchema,
            checkpoint: checkpointSchema,
          },
          required: ["answer", "marker", "brief", "evidence", "checkpoint"],
          additionalProperties: false,
        },
        effect: "read" as const,
        permissions: [],
        capabilities: [],
        retry: { maxAttempts: 1, safeErrorClasses: [] },
        timeoutSeconds: 300,
        cancellation: "reconcile" as const,
      };
      const definition: Definition = {
        formatVersion: "agents-assemble.playbook/1",
        package: { id: `test/native-journey-${randomUUID()}`, version: "1.0.0" },
        inputs: {},
        outputs: action.outputs,
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
      const draft = draftRow.parse(
        await call("/catalog/playbooks", { title: "Real native journey", definition }),
      );
      const candidate = row.parse(
        await call(`/collaboration/catalog/${draft.id}/candidates`, {
          epoch: draft.data.epoch,
          expectedSequence: 0,
        }),
      );
      const version = row.parse(
        await call(`/catalog/playbooks/${draft.id}/publish`, {
          candidateId: candidate.id,
          expectedHead: 0,
        }),
      );
      tls = await createRunnerTlsServer(runnerApp.router.app, runnerApp.fleet.authority);
      await new Promise<void>((resolve) => tls?.listen(0, "127.0.0.1", resolve));
      const tlsAddress = tls.address();
      if (!tlsAddress || typeof tlsAddress === "string") throw new Error("fixture_address_missing");
      const challenge = z
        .object({ enrollmentToken: z.string(), runnerId: z.uuid() })
        .parse(await call("/fleet/enrollments", { name: "Real local Codex runner" }));
      const tokenFile = join(directory, "enrollment-token"),
        runnerDirectory = join(directory, "runner"),
        cli = resolve("apps/runner/src/cli.ts");
      await writeFile(tokenFile, challenge.enrollmentToken, { mode: 0o600 });
      await exec(
        process.execPath,
        [
          "--import",
          "tsx",
          cli,
          "enroll",
          "--directory",
          runnerDirectory,
          "--service",
          `https://127.0.0.1:${tlsAddress.port}`,
          "--ca",
          join(runnerApp.fleet.authority.directory, "ca.pem"),
          "--token-file",
          tokenFile,
          "--codex",
          process.env.AA_CODEX_BINARY ?? "codex",
        ],
        { timeout: 20000 },
      );
      daemon = spawn(
        process.execPath,
        ["--import", "tsx", cli, "daemon", "run", "--directory", runnerDirectory],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      daemon.stderr?.on("data", (chunk) => {
        diagnostic = (diagnostic + chunk.toString()).slice(-4000);
      });
      await poll(async () => {
        const fleet = z
          .object({
            items: z.array(
              z
                .object({
                  id: z.uuid(),
                  capabilities: z
                    .object({ nativeLoginReady: z.boolean() })
                    .passthrough()
                    .nullable(),
                })
                .passthrough(),
            ),
          })
          .parse(await call("/runners"));
        return fleet.items.some(
          (runner) => runner.id === challenge.runnerId && runner.capabilities?.nativeLoginReady,
        )
          ? true
          : undefined;
      });
      const run = row.parse(
        await call("/runs", {
          projectId: project.id,
          repositoryId: repository.id,
          versionId: version.id,
          sourceCommit: baseline,
          inputs: {
            brief,
            instructions:
              "Perform this fixed read-only qualification. First call aa_read_artifact with the exact brief reference and read its unpredictable marker. Next call request_user_input with exactly one nonsensitive question, Which fixture color should be chosen?, offering Blue and Green. Wait for the answer. After Blue is selected call aa_create_artifact with mediaType text/markdown and content Native question answered: Blue. Marker: followed by the exact marker read from the brief. Next call aa_checkpoint with no arguments. Return exact structured output answer=Blue, marker from the read brief, brief=the supplied exact reference, evidence=the actual created artifact reference, checkpoint=the actual aa_checkpoint reference. Do not use shell tools, read other files, modify repository files, or invent references.",
          },
          runtimeBindings: { worker: runtime.id },
          environmentProfileId: environment.id,
        }),
      );
      const human = await poll(async () =>
        z
          .object({ items: z.array(envelope(humanRequestSchema)) })
          .parse(await call("/requests"))
          .items.find(
            (request) => request.data.runId === run.id && request.data.action === "nativeQuestion",
          ),
      );
      const question = nativeQuestionSchema.parse(human.data.input);
      expect(question.questions).toHaveLength(1);
      const selected = question.questions[0].options?.find((option) =>
        option.label.startsWith("Blue"),
      );
      if (!selected) throw new Error("native_fixture_choice_missing");
      expect(runRow.parse(await call(`/runs/${run.id}`)).data.holds).toHaveProperty(
        `question:${human.id}`,
      );
      // The dedicated runner listener stays available while the human/API application is replaced.
      await new Promise<void>((resolve) => http?.close(() => resolve()));
      http = undefined;
      await api.close();
      api = await createApplication(config);
      worker = new Worker(api);
      http = serve({ fetch: api.router.app.fetch, hostname: "127.0.0.1", port: httpAddress.port });
      await new Promise<void>((resolve) => http?.once("listening", resolve));
      const restored = envelope(humanRequestSchema).parse(await call(`/requests/${human.id}`));
      expect(restored).toEqual(human);
      const response = {
          expectedVersion: human.version,
          manifestDigest: human.data.manifestDigest,
          response: { answers: { [question.questions[0].id]: { answers: [selected.label] } } },
          reason: "Fixed nonsecret native qualification answer",
        },
        answerKey = randomUUID();
      const accepted = await call(`/requests/${human.id}/respond`, response, answerKey);
      expect(await call(`/requests/${human.id}/respond`, response, answerKey)).toEqual(accepted);
      const completed = await poll(async () => {
        const current = runRow.parse(await call(`/runs/${run.id}`));
        if (["failed", "outcome_unknown", "canceled"].includes(current.data.status))
          throw new Error(`native_run_${current.data.status}:${current.data.reason}`);
        return current.data.status === "completed" ? current : undefined;
      }, 120000);
      const output = artifactOutput.parse(completed.data.engine.output);
      expect(output.marker).toBe(marker);
      expect(output.brief).toEqual(brief);
      expect(output.checkpoint.commit).toBe(baseline);
      expect(output.checkpoint.repositoryId).toBe("555");
      expect(completed.data.holds).toEqual({});
      const evidence = envelope(
        z.object({ digest: z.string(), content: z.string() }).passthrough(),
      ).parse(await call(`/knowledge/revisions/${output.evidence.revisionId}`));
      expect(evidence.data.digest).toBe(output.evidence.digest);
      expect(evidence.data.content).toContain("Native question answered: Blue");
      expect(evidence.data.content).toContain(marker);
      const conversation = z
        .object({
          inputs: z.array(
            envelope(z.object({ kind: z.string(), status: z.string() }).passthrough()),
          ),
        })
        .passthrough()
        .parse(await call(`/runs/${run.id}/conversation`));
      expect(conversation.inputs.filter((input) => input.data.kind === "answer")).toHaveLength(1);
      expect(conversation.inputs.find((input) => input.data.kind === "answer")?.data.status).toBe(
        "delivered",
      );
      const assignments = z
        .object({
          items: z.array(
            envelope(
              z
                .object({
                  status: z.string(),
                  native: z.object({ threadId: z.string(), turnId: z.string() }),
                })
                .passthrough(),
            ),
          ),
        })
        .parse(await call(`/runs/${run.id}/assignments`));
      expect(assignments.items).toHaveLength(1);
      expect(assignments.items[0].data).toMatchObject({
        status: "completed",
        native: { threadId: question.threadId, turnId: question.turnId },
      });
      const remoteRefs = (
        await exec(
          "git",
          ["for-each-ref", "--format=%(refname) %(objectname)", "refs/agents-assemble/checkpoints"],
          { cwd: upstream },
        )
      ).stdout
        .trim()
        .split("\n");
      expect(remoteRefs.length).toBeGreaterThanOrEqual(1);
      expect(remoteRefs.every((ref) => ref.endsWith(baseline))).toBe(true);
      if (process.env.AA_NATIVE_JOURNEY_EVIDENCE)
        await writeFile(
          process.env.AA_NATIVE_JOURNEY_EVIDENCE,
          JSON.stringify(
            {
              observedAt: new Date().toISOString(),
              status: "passed",
              runtime: {
                codexVersion: "0.153.4",
                model,
                effort,
                sandbox: "read-only",
                authentication: "existing_native_chatgpt_login",
              },
              transport: "actual CLI and mutual TLS",
              provider: "local HTTP GitHub protocol and temporary bare Git remote",
              apiRestart:
                "pending request restored unchanged while dedicated runner listener remained available",
              runId: run.id,
              questionId: human.id,
              nativeIdentity: {
                requestId: question.requestId,
                threadId: question.threadId,
                turnId: question.turnId,
                itemId: question.itemId,
              },
              answer:
                "one durable HTTP answer, duplicate operation returned original response, one confirmed native delivery",
              output,
              checkpointRefs: remoteRefs.length,
              limitations: [
                "No external repository writes or deployments",
                "No privileged supervisor qualification",
                "Browser rendering qualified separately",
                "Writer coverage remains incomplete; no automatic takeover",
              ],
            },
            null,
            2,
          ),
        );
    } finally {
      if (daemon && daemon.exitCode === null) {
        daemon.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            daemon?.kill("SIGKILL");
            resolve();
          }, 10000);
          daemon?.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      if (http) await new Promise<void>((resolve) => http?.close(() => resolve()));
      if (tls) await new Promise<void>((resolve) => tls?.close(() => resolve()));
      await Promise.all([api?.close(), runnerApp?.close()]);
      if (github) await new Promise<void>((resolve) => github?.close(() => resolve()));
      await db.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  },
  300000,
);
