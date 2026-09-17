import { expect, test } from "bun:test";
import type { WorkflowDefinition } from "@factory/workflow";
import { saveWorkflowDraft } from "./saveWorkflowDraft";
test("saving trims workflow and step names while preserving positions and approvals", async () => {
  const draft: WorkflowDefinition = {
    workflowId: "build",
    name: "  Build  ",
    description: "A workflow",
    status: "draft",
    tags: [" Planning ", "planning"],
    positions: { a: { x: 10, y: 20 } },
    activities: [
      {
        activityId: "a",
        name: "  First  ",
        description: "UI note",
        instructions: "Do it",
        execution: { kind: "agent", harness: "codex", model: "gpt-5.6-sol", effort: "medium" },
        humanInput: "approval",
        outcomes: [{ name: "done", handoff: { targetActivityId: null, continuation: "approval" } }],
      },
    ],
  };
  const saved = await saveWorkflowDraft({ async updateWorkflow(definition) { return definition; } }, draft);
  expect(saved.name).toBe("Build");
  expect(saved.description).toBe("A workflow");
  expect(saved.tags).toEqual(["planning"]);
  expect(saved.activities[0]!.name).toBe("First");
  expect(saved.positions).toEqual({ a: { x: 10, y: 20 } });
  expect(saved.activities[0]!.outcomes).toEqual([
    { name: "done", handoff: { targetActivityId: null, continuation: "approval" } },
  ]);
});
