import { expect, test } from "bun:test";
import { createFeatureBuildingWorkflow } from "./createFeatureBuildingWorkflow";
import { validateWorkflowDefinition } from "./validateWorkflowDefinition";
test("empty canvas is allowed and the starter passes", () => {
  expect(
    validateWorkflowDefinition({ workflowId: "blank", name: "Blank", description: "", activities: [], positions: {} }),
  ).toBeNull();
  expect(validateWorkflowDefinition(createFeatureBuildingWorkflow())).toBeNull();
});
test("terminal steps end the run and free cycles pass", () => {
  const workflow = createFeatureBuildingWorkflow();
  const review = workflow.activities.find((activity) => activity.activityId === "review")!;
  expect(review.outcomes.some((outcome) => outcome.handoff.targetActivityId === null)).toBe(true);
  expect(validateWorkflowDefinition(workflow)).toBeNull();
  const cyclic = createFeatureBuildingWorkflow();
  cyclic.activities.find((activity) => activity.activityId === "review")!.outcomes = [
    { name: "retry", handoff: { targetActivityId: "implement", continuation: "automatic" } },
  ];
  cyclic.activities.find((activity) => activity.activityId === "implement")!.outcomes = [
    { name: "done", handoff: { targetActivityId: "review", continuation: "automatic" } },
  ];
  expect(validateWorkflowDefinition(cyclic)).toBeNull();
});
test("unknown model or effort is rejected and description is ignored", () => {
  const workflow = createFeatureBuildingWorkflow();
  workflow.activities[0]!.description = "UI-only note";
  expect(validateWorkflowDefinition(workflow)).toBeNull();
  workflow.activities[0]!.execution.model = "unknown-model";
  expect(validateWorkflowDefinition(workflow)).toContain("catalogue");
  workflow.activities[0]!.execution.model = "gpt-5.6-sol";
  workflow.activities[0]!.execution.effort = "ultra";
  expect(validateWorkflowDefinition(workflow)).toContain("catalogue");
});
test("step and outcome names must be unique and handoff targets must exist", () => {
  const workflow = createFeatureBuildingWorkflow();
  workflow.activities[1]!.name = workflow.activities[0]!.name;
  expect(validateWorkflowDefinition(workflow)).toContain("Step names");
  workflow.activities[1]!.name = "Research and plan";
  workflow.activities[0]!.outcomes.push({
    name: workflow.activities[0]!.outcomes[0]!.name,
    handoff: { targetActivityId: null, continuation: "automatic" },
  });
  expect(validateWorkflowDefinition(workflow)).toContain("outcomes");
  workflow.activities[0]!.outcomes.pop();
  workflow.activities[0]!.outcomes[0]!.handoff.targetActivityId = "missing";
  expect(validateWorkflowDefinition(workflow)).toContain("target");
});
