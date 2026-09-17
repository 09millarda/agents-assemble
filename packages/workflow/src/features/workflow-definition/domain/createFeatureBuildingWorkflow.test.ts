import { expect, test } from "bun:test";
import { createFeatureBuildingWorkflow } from "./createFeatureBuildingWorkflow";
test("the starter is a small graph with positions, human input modes and approval handoffs", () => {
  const workflow = createFeatureBuildingWorkflow();
  expect(workflow.activities.map((activity) => activity.activityId)).toEqual([
    "requirements",
    "plan",
    "implement",
    "review",
  ]);
  expect(workflow.activities.map((activity) => activity.humanInput)).toEqual([
    "input",
    "approval",
    "off",
    "approval",
  ]);
  expect(workflow.positions["requirements"]).toEqual({ x: 40, y: 40 });
  expect(workflow.activities[3]!.outcomes).toEqual([
    { name: "pass", handoff: { targetActivityId: null, continuation: "approval" } },
    { name: "changes_requested", handoff: { targetActivityId: "implement", continuation: "automatic" } },
  ]);
  for (const activity of workflow.activities)
    expect(activity.execution).toMatchObject({ kind: "agent", harness: "codex" });
  workflow.activities[0]!.instructions = "Changed";
  expect(createFeatureBuildingWorkflow().activities[0]!.instructions).not.toBe("Changed");
});
