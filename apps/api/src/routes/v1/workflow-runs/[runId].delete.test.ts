import { expect, test } from "bun:test";
import { createWorkflowRun, type WorkflowDefinition } from "@factory/workflow";
import { buildWorkflowTestApp } from "../../testing/buildWorkflowTestApp";
import { InMemoryWorkflowStore } from "../../../features/workflow-management/adapters/testing/InMemoryWorkflowStore";

const definition: WorkflowDefinition = {
  workflowId: "build",
  name: "Build",
  description: "",
  status: "published",
  tags: [],
  positions: {},
  activities: [],
};

function terminalRun(runId: string, status: "completed" | "cancelled" | "failed" = "completed") {
  const run = createWorkflowRun(
    {
      runId,
      projectId: "project",
      daemonId: "daemon",
      workflow: definition,
      workspace: { projectPath: "/tmp/project" },
    },
    "2026-09-15T12:00:00.000Z",
  );
  run.status = status;
  return run;
}

test("deleting a terminal run hard-deletes so get returns 404 and lists omit it", async () => {
  const store = new InMemoryWorkflowStore();
  store.runs.set("gone", terminalRun("gone", "completed"));
  store.runs.set("kept", terminalRun("kept", "failed"));
  store.messages.set("message-1", {
    kind: "human",
    response: { messageId: "message-1", runId: "gone", action: "cancel" },
  });
  const app = buildWorkflowTestApp(store);

  const response = await app.request("/v1/workflow-runs/gone", { method: "DELETE" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: true });
  expect((await app.request("/v1/workflow-runs/gone")).status).toBe(404);
  const list = await (await app.request("/v1/workflow-runs")).json();
  expect(list.data.map((run: { runId: string }) => run.runId)).toEqual(["kept"]);
  expect(store.messages.has("message-1")).toBe(false);
});

test("deleting a missing run returns not found", async () => {
  const app = buildWorkflowTestApp(new InMemoryWorkflowStore());
  const response = await app.request("/v1/workflow-runs/missing", { method: "DELETE" });
  expect(response.status).toBe(404);
  expect((await response.json()).code).toBe("WORKFLOW_RUN_NOT_FOUND");
});

test("deleting an active run is rejected with a cancel-first hint", async () => {
  const store = new InMemoryWorkflowStore();
  const active = createWorkflowRun(
    {
      runId: "active",
      projectId: "project",
      daemonId: "daemon",
      workflow: definition,
      workspace: { projectPath: "/tmp/project" },
    },
    "2026-09-15T12:00:00.000Z",
  );
  active.status = "running";
  store.runs.set("active", active);
  const app = buildWorkflowTestApp(store);
  const response = await app.request("/v1/workflow-runs/active", { method: "DELETE" });
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe("RUN_NOT_TERMINAL");
  expect((await app.request("/v1/workflow-runs/active")).status).toBe(200);
});
