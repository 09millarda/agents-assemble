import { expect, test } from "bun:test";
import {
  createWorkflowRun,
  createFeatureBuildingWorkflow,
  type WorkflowTransition,
  type WorkflowRuntimePort,
} from "@factory/workflow";
import { tryApplyWorkflowMessage } from "./tryApplyWorkflowMessage";
const now = "2026-09-15T12:00:00.000Z";
function queued() {
  return createWorkflowRun(
    {
      runId: "durable-run",
      projectId: "project",
      daemonId: "daemon",
      workflow: createFeatureBuildingWorkflow(),
      workspace: { projectPath: "/project" },
    },
    now,
  );
}

test("a lost database save response retries the same message without creating another activity execution", async () => {
  let current = queued();
  let databaseResponseAvailable = false;
  const commands = new Set<string>();
  const runtime: WorkflowRuntimePort = {
    findRun: async () => structuredClone(current),
    saveTransition: async (transition: WorkflowTransition) => {
      current = structuredClone(transition.run);
      for (const command of transition.commands)
        commands.add(command.commandId);
      if (!databaseResponseAvailable) throw new Error("Database response lost");
    },
  };
  const message = { kind: "start" as const, messageId: "start-durable-run" };
  expect(
    await tryApplyWorkflowMessage("durable-run", message, runtime, now),
  ).toEqual({ outcome: "retry", error: "Database response lost" });
  databaseResponseAvailable = true;
  expect(
    await tryApplyWorkflowMessage("durable-run", message, runtime, now),
  ).toEqual({ outcome: "applied", status: "running" });
  expect(current.executions.map((execution) => execution.executionId)).toEqual([
    "durable-run:execution:1",
  ]);
  expect([...commands]).toEqual([
    "durable-run:execution:1:dispatch:1:attempt:0",
  ]);
});

test("an empty frozen canvas completes on start", async () => {
  let current = queued();
  current.snapshot.activities = [];
  current.snapshot.positions = {};
  const notifications: string[] = [];
  const runtime: WorkflowRuntimePort = {
    findRun: async () => structuredClone(current),
    saveTransition: async (transition) => {
      current = structuredClone(transition.run);
      notifications.push(
        ...transition.notifications.map((notification) => notification.kind),
      );
    },
  };
  expect(
    await tryApplyWorkflowMessage(
      "durable-run",
      { kind: "start", messageId: "empty-canvas" },
      runtime,
      now,
    ),
  ).toEqual({ outcome: "applied", status: "completed" });
  expect(current.interaction).toBeNull();
  expect(notifications).toEqual(["result"]);
});
