import { expect, test } from "bun:test";
import { createWorkflowRun, type WorkflowRun } from "@factory/workflow";
import { deleteWorkflowRun } from "./deleteWorkflowRun";
import type { WorkflowDefinition } from "@factory/workflow";

const definition: WorkflowDefinition = {
  workflowId: "build",
  name: "Build",
  description: "",
  status: "published",
  tags: [],
  positions: {},
  activities: [],
};

function makeRun(status: WorkflowRun["status"]): WorkflowRun {
  const run = createWorkflowRun(
    {
      runId: "run-1",
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

test("deletes a terminal run", async () => {
  const run = makeRun("completed");
  const result = await deleteWorkflowRun(
    {
      findRun: async () => run,
      deleteRun: async () => true,
    },
    "run-1",
  );
  expect(result).toEqual({ ok: true, value: { deleted: true } });
});

test("returns not found when the run does not exist", async () => {
  const result = await deleteWorkflowRun(
    {
      findRun: async () => null,
      deleteRun: async () => false,
    },
    "missing",
  );
  expect(result).toEqual({
    ok: false,
    error: {
      code: "WORKFLOW_RUN_NOT_FOUND",
      message: "Workflow run does not exist.",
    },
  });
});

test("refuses to delete a non-terminal run with a cancel-first hint", async () => {
  for (const status of ["queued", "running", "awaiting-human", "recovery-required"] as const) {
    const result = await deleteWorkflowRun(
      {
        findRun: async () => makeRun(status),
        deleteRun: async () => {
          throw new Error("deleteRun must not be called for active runs");
        },
      },
      "run-1",
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "RUN_NOT_TERMINAL",
        message: "Cancel the run before deleting it.",
      },
    });
  }
});
