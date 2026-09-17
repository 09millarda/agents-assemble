import { expect, test } from "bun:test";
import { deleteWorkflowDefinition } from "./deleteWorkflowDefinition";

test("deletes an existing workflow definition", async () => {
  const result = await deleteWorkflowDefinition({
    deleteDefinition: async () => true,
  }, "build");

  expect(result).toEqual({ ok: true, value: { deleted: true } });
});

test("returns not found when the workflow definition does not exist", async () => {
  const result = await deleteWorkflowDefinition(
    { deleteDefinition: async () => false },
    "missing",
  );

  expect(result).toEqual({
    ok: false,
    error: {
      code: "WORKFLOW_NOT_FOUND",
      message: "Workflow does not exist.",
    },
  });
});
