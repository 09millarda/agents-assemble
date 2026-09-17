import { expect, test } from "bun:test";
import { canExecuteWorkflow } from "./canExecuteWorkflow";
import { createFeatureBuildingWorkflow } from "./createFeatureBuildingWorkflow";
test("static catalogue gates execution without daemon discovery", () => {
  expect(canExecuteWorkflow(createFeatureBuildingWorkflow())).toBe(true);
  const unknown = createFeatureBuildingWorkflow();
  unknown.activities[0]!.execution.model = "unknown-model";
  expect(canExecuteWorkflow(unknown)).toBe(false);
  const effort = createFeatureBuildingWorkflow();
  effort.activities[0]!.execution.effort = "ultra";
  expect(canExecuteWorkflow(effort)).toBe(false);
  expect(canExecuteWorkflow({ workflowId: "blank", name: "Blank", description: "", status: "draft", tags: [], activities: [], positions: {} })).toBe(true);
});
