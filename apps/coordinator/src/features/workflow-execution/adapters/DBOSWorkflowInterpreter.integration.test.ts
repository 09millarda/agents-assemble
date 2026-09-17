import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import {
  createDatabaseConnection,
  DrizzleWorkflowRuntimeAdapter,
  sql,
  projects,
  daemons,
} from "@factory/db";
import {
  createWorkflowRun,
  createFeatureBuildingWorkflow,
} from "@factory/workflow";
const databaseUrl = process.env.FACTORY_INTEGRATION_DATABASE_URL;
test.skipIf(!databaseUrl)(
  "Node DBOS accepts Bun SQL messages and restores a persisted human wait after a hard restart",
  async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.includes("test"))
      throw new Error("Integration database must be a dedicated test database");
    const database = createDatabaseConnection(databaseUrl);
    const runtime = new DrizzleWorkflowRuntimeAdapter(database);
    const runId = `restart-${crypto.randomUUID()}`;
    await database
      .insert(projects)
      .values({
        projectId: "coordinator-project",
        name: "Coordinator test",
        absolutePath: "/project",
      })
      .onConflictDoNothing();
    await database
      .insert(daemons)
      .values({
        daemonId: "coordinator-daemon",
        machineName: "Coordinator test",
        displayName: "Coordinator test",
        authTokenHash: "test",
      })
      .onConflictDoNothing();
    const run = createWorkflowRun(
      {
        runId,
        projectId: "coordinator-project",
        daemonId: "coordinator-daemon",
        workflow: createFeatureBuildingWorkflow(),
        workspace: { projectPath: "/project" },
      },
      new Date().toISOString(),
    );
    await runtime.saveTransition({ run, commands: [], notifications: [] });
    let child: ChildProcess | undefined;
    let logs = "";
    const launch = async () => {
      child = spawn("node", ["--import", "tsx", "src/index.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl, COORDINATOR_PORT: "3098" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk) => {
        logs += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        logs += String(chunk);
      });
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
    };
    try {
      await launch();
      await database.execute(
        sql`select dbos.enqueue_workflow('interpretWorkflowRun','workflow-runs',ARRAY[${JSON.stringify(runId)}::json],workflow_id => ${runId},app_version => 'workflow-v1',application_name => 'factory-coordinator')`,
      );
      await waitFor(
        async () => (await runtime.findRun(runId))?.status === "running",
        () => logs,
      );
      const started = (await runtime.findRun(runId))!;
      const execution = started.executions[0];
      const question = {
        kind: "fact",
        fact: {
          factId: `${runId}:question`,
          runId,
          executionId: execution.executionId,
          commandId: execution.commandId,
          type: "question",
          message: "What should we build?",
          sessionId: "session-1",
          interactionId: `${runId}:interaction`,
        },
      };
      await database.execute(
        sql`select dbos.send_message(${runId},${JSON.stringify(question)}::json,'commands',${runId + ":question"})`,
      );
      await waitFor(
        async () => (await runtime.findRun(runId))?.status === "awaiting-human",
        () => logs,
      );
      child!.kill("SIGKILL");
      await new Promise<void>((resolve) =>
        child!.once("exit", () => resolve()),
      );
      await launch();
      const restored = (await runtime.findRun(runId))!;
      expect(restored.interaction?.prompt).toBe("What should we build?");
      expect(restored.executions[0].sessionId).toBe("session-1");
      const answer = {
        kind: "human",
        response: {
          messageId: `${runId}:answer`,
          runId,
          interactionId: `${runId}:interaction`,
          action: "answer",
          answer: "Search",
        },
      };
      await database.execute(
        sql`select dbos.send_message(${runId},${JSON.stringify(answer)}::json,'commands',${runId + ":answer"})`,
      );
      await waitFor(
        async () =>
          (await runtime.findRun(runId))?.executions[0].dispatchSequence === 2,
        () => logs,
      );
      await database.execute(
        sql`select dbos.send_message(${runId},${JSON.stringify(answer)}::json,'commands',${runId + ":duplicate"})`,
      );
      const cancel = {
        kind: "human",
        response: { messageId: `${runId}:cancel`, runId, action: "cancel" },
      };
      await database.execute(
        sql`select dbos.send_message(${runId},${JSON.stringify(cancel)}::json,'commands',${runId + ":cancel"})`,
      );
      await waitFor(
        async () => (await runtime.findRun(runId))?.status === "cancelled",
        () => logs,
      );
      expect(
        (await runtime.findRun(runId))!.executions[0].dispatchSequence,
      ).toBe(2);
    } finally {
      child?.kill("SIGKILL");
    }
  },
  40000,
);
async function waitFor(
  check: () => Promise<boolean>,
  logs: () => string,
): Promise<void> {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${logs()}`);
}
