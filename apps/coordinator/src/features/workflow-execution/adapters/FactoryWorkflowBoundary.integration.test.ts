import { WebSocket } from "ws";
import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createDatabaseConnection, daemons } from "@factory/db";
import {
  createFeatureBuildingWorkflow,
  type WorkflowDaemonCommand,
  type WorkflowRun,
} from "@factory/workflow";
const databaseUrl = process.env.FACTORY_INTEGRATION_DATABASE_URL;
test.skipIf(!databaseUrl)(
  "real Bun HTTP and daemon gateway feed one Node DBOS interpreter with frozen documents and duplicate-safe approvals",
  async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.includes("test"))
      throw new Error("A dedicated integration test database is required");
    const database = createDatabaseConnection(databaseUrl);
    const identity = crypto.randomUUID();
    const daemonId = `boundary-${identity}`;
    const token = crypto.randomUUID();
    await database
      .insert(daemons)
      .values({
        daemonId,
        machineName: "Boundary daemon",
        displayName: "Boundary daemon",
        status: "online",
        authTokenHash: createHash("sha256").update(token).digest("hex"),
      });
    const children: ChildProcess[] = [];
    let logs = "";
    let socket: WebSocket | undefined;
    function launch(
      executable: string,
      args: string[],
      port: string,
      cwd: string,
    ) {
      const child = spawn(executable, args, {
        cwd,
        env: { ...process.env, DATABASE_URL: databaseUrl, COORDINATOR_PORT: port },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      child.stdout?.on("data", (chunk) => (logs += String(chunk)));
      child.stderr?.on("data", (chunk) => (logs += String(chunk)));
      return child;
    }
    const api = "http://127.0.0.1:3097";
    async function request(path: string, body?: unknown) {
      const response = await fetch(
        api + path,
        body === undefined
          ? {}
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(`${response.status} ${JSON.stringify(result)}`);
      return result;
    }
    try {
      launch(
        "node",
        ["--import", "tsx", "src/index.ts"],
        "3098",
        process.cwd(),
      );
      await waitFor(
        async () => {
          try {
            return (await fetch("http://127.0.0.1:3098/health")).ok;
          } catch {
            return false;
          }
        },
        () => logs,
      );
      launch("bun", ["run", "src/index.ts"], "3097", `${process.cwd()}/../api`);
      await waitFor(
        async () => {
          try {
            return (await fetch(api + "/health")).ok;
          } catch {
            return false;
          }
        },
        () => logs,
      );
      const commands: WorkflowDaemonCommand[] = [];
      socket = new WebSocket("ws://127.0.0.1:3097/ws/daemon", {
        headers: { authorization: `Bearer ${token}` },
      });
      await new Promise<void>((resolve, reject) => {
        socket!.onopen = () =>
          socket!.send(
            JSON.stringify({
              type: "daemon.hello",
              daemonId,
              machineName: "Boundary daemon",
              capabilities: [
                {
                  harness: "codex",
                  version: "0.154.0",
                  models: [{ model: "gpt-5.6-sol", efforts: ["high"] }],
                  questions: true,
                  permissions: true,
                  structuredOutput: true,
                },
              ],
            }),
          );
        socket!.onerror = () => reject(new Error("Socket failed"));
        socket!.onmessage = (event) => {
          const frame = JSON.parse(String(event.data));
          if (frame.type === "daemon.welcome") resolve();
          if (frame.type === "workflow.command") commands.push(frame.command);
        };
      });
      const workflow = createFeatureBuildingWorkflow();
      workflow.workflowId = `boundary-${identity}`;
      workflow.activities = workflow.activities.slice(0, 1);
      workflow.activities[0].outcomes[0].handoff.targetActivityId = null;
      workflow.positions = {};
      await request("/v1/workflows", workflow);
      const project = (await request("/v1/projects", {
        name: "Boundary project",
        absolutePath: "/boundary-project",
      })) as { projectId: string };
      await request(`/v1/projects/${project.projectId}/assign`, { daemonId });
      await request(`/v1/projects/${project.projectId}/enabled-workflows`, {
        workflowIds: [workflow.workflowId],
      });
      const runId = `boundary-run-${identity}`;
      const startBody = {
        requestId: runId,
        projectId: project.projectId,
        workflowId: workflow.workflowId,
      };
      const started = (await request(
        "/v1/workflow-runs",
        startBody,
      )) as WorkflowRun;
      expect(started.kickoffPrompt).toBeNull();
      await waitFor(
        async () => commands.some((command) => command.runId === runId),
        () => logs,
      );
      const first = commands.find((command) => command.runId === runId)!;
      expect(first).toMatchObject({
        workspace: { projectPath: "/boundary-project" },
        activity: {
          execution: { harness: "codex", model: "gpt-5.6-sol", effort: "high" },
        },
      });
      const fact = {
        factId: `${runId}:question`,
        runId,
        executionId: first.executionId,
        commandId: first.commandId,
        type: "question",
        message: "What should we build?",
        sessionId: "session-one",
        interactionId: `${runId}:question`,
      };
      socket.send(JSON.stringify({ type: "workflow.fact", fact }));
      await waitFor(
        async () =>
          ((await request(`/v1/workflow-runs/${runId}`)) as WorkflowRun)
            .interaction?.kind === "question",
        () => logs,
      );
      const waiting = (await request(
        `/v1/workflow-runs/${runId}`,
      )) as WorkflowRun;
      expect(waiting.executions[0].transcript[0].content).toBe(
        "What should we build?",
      );
      workflow.activities[0].execution = {
        kind: "agent",
        harness: "codex",
        model: "changed-model",
        effort: "low",
      };
      await request(`/v1/workflows/${workflow.workflowId}/update`, workflow);
      const answer = {
        messageId: `${runId}:answer`,
        interactionId: waiting.interaction!.interactionId,
        action: "answer",
        answer: "A keyboard accessible search page",
      };
      await request(`/v1/workflow-runs/${runId}/commands`, answer);
      await request(`/v1/workflow-runs/${runId}/commands`, answer);
      await waitFor(
        async () => commands.some((command) => command.kind === "answer"),
        () => logs,
      );
      const turn = commands.find((command) => command.kind === "answer")!;
      expect(turn.activity.execution).toEqual({
        kind: "agent",
        harness: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
      });
      socket.send(
        JSON.stringify({
          type: "workflow.fact",
          fact: {
            factId: `${runId}:done`,
            runId,
            executionId: turn.executionId,
            commandId: turn.commandId,
            type: "completed",
            sessionId: "session-one",
            workspaceResult: {
              worktreePath: "/worktrees/boundary",
              branch: "codex/boundary",
              pinnedCommit: "abc",
            },
            completion: {
              outcome: "ready",
              outputs: [
                {
                  documentId: "acceptance-criteria",
                  content:
                    "# Goal\nSearch\n# Acceptance criteria\nKeyboard accessible\n# Constraints\nLocal",
                },
              ],
            },
          },
        }),
      );
      await waitFor(
        async () =>
          ((await request(`/v1/workflow-runs/${runId}`)) as WorkflowRun)
            .interaction?.kind === "approval",
        () => logs,
      );
      const approval = (await request(
        `/v1/workflow-runs/${runId}`,
      )) as WorkflowRun;
      expect(approval.interaction!.outputRevisionIds).toEqual([
        `${runId}:document:acceptance-criteria:1`,
      ]);
      expect(
        (
          (await request(
            `/v1/documents/${encodeURIComponent(approval.interaction!.outputRevisionIds[0])}`,
          )) as { content: string }
        ).content,
      ).toContain("Keyboard accessible");
      const approve = {
        messageId: `${runId}:approve`,
        interactionId: approval.interaction!.interactionId,
        action: "approve",
      };
      await request(`/v1/workflow-runs/${runId}/commands`, approve);
      await request(`/v1/workflow-runs/${runId}/commands`, approve);
      await waitFor(
        async () =>
          ((await request(`/v1/workflow-runs/${runId}`)) as WorkflowRun)
            .status === "completed",
        () => logs,
      );
      const completed = (await request(
        `/v1/workflow-runs/${runId}`,
      )) as WorkflowRun;
      expect(completed.executions).toHaveLength(1);
      expect(completed.executions[0].dispatchSequence).toBe(2);
      expect(completed.documents).toHaveLength(1);
    } finally {
      socket?.close();
      for (const child of children) child.kill("SIGKILL");
    }
  },
  40000,
);
async function waitFor(check: () => Promise<boolean>, logs: () => string) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${logs()}`);
}
