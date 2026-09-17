import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDatabaseConnection, sql } from "@factory/db";
import {
  createWorkflowRun,
  createFeatureBuildingWorkflow,
} from "@factory/workflow";
const databaseUrl = process.env.FACTORY_INTEGRATION_DATABASE_URL;

test.skipIf(!databaseUrl)(
  "durable retries outlast a prolonged store outage and consume a queued cancellation after recovery",
  async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.includes("test"))
      throw new Error("Use a dedicated integration test database.");
    const directory = await mkdtemp(join(process.cwd(), ".workflow-failure-"));
    const runId = `store-outage-${crypto.randomUUID()}`;
    const run = createWorkflowRun(
      {
        runId,
        projectId: "project",
        daemonId: "daemon",
        workflow: createFeatureBuildingWorkflow(),
        workspace: { projectPath: "/project" },
      },
      new Date().toISOString(),
    );
    await writeFile(join(directory, "state.json"), JSON.stringify(run));
    await writeFile(
      join(directory, "main.ts"),
      `
import { DBOS } from "@dbos-inc/dbos-sdk";
import { readFile, writeFile } from "node:fs/promises";
import { registerWorkflowInterpreter } from "../src/features/workflow-execution/adapters/DBOSWorkflowInterpreter";
const directory = ${JSON.stringify(directory)};
let unavailableReads = 25;
const runtime = {
  async findRun() {
    if (unavailableReads-- > 0) throw new Error("Temporary store outage");
    return JSON.parse(await readFile(directory + "/state.json", "utf8"));
  },
  async saveTransition(transition) { await writeFile(directory + "/state.json", JSON.stringify(transition.run)); }
};
registerWorkflowInterpreter(runtime, (error) => { console.error(error); process.exit(1); }, { retryDelayMs: 10 });
DBOS.setConfig({name:"factory-coordinator",systemDatabaseUrl:process.env.DATABASE_URL,applicationVersion:"workflow-v1",executorID:${JSON.stringify(runId)},runAdminServer:false});
await DBOS.launch();
await writeFile(directory + "/ready", "ready");
`,
    );
    let child: ChildProcess | undefined;
    let logs = "";
    const database = createDatabaseConnection(databaseUrl);
    try {
      child = spawn("node", ["--import", "tsx", join(directory, "main.ts")], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk) => {
        logs += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        logs += String(chunk);
      });
      await waitFor(
        async () => Bun.file(join(directory, "ready")).exists(),
        () => logs,
      );
      await database.execute(
        sql`select dbos.enqueue_workflow('interpretWorkflowRun','workflow-runs',ARRAY[${JSON.stringify(runId)}::json],workflow_id=>${runId},app_version=>'workflow-v1',application_name=>'factory-coordinator')`,
      );
      const cancel = {
        kind: "human",
        response: { messageId: `${runId}:cancel`, runId, action: "cancel" },
      };
      await database.execute(
        sql`select dbos.send_message(${runId},${JSON.stringify(cancel)}::json,'commands',${runId + ":cancel"})`,
      );
      await waitFor(
        async () => {
          try {
            return (
              JSON.parse(await readFile(join(directory, "state.json"), "utf8"))
                .status === "cancelled"
            );
          } catch {
            return false;
          }
        },
        () => logs,
      );
      const completed = JSON.parse(
        await readFile(join(directory, "state.json"), "utf8"),
      );
      expect(completed.status).toBe("cancelled");
      expect(completed.executions).toHaveLength(1);
    } finally {
      child?.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);
async function waitFor(
  check: () => Promise<boolean>,
  logs: () => string,
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out: ${logs()}`);
}
