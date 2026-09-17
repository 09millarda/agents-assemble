import { expect, test } from "bun:test";
import { createBugTriageWorkflow } from "./createBugTriageWorkflow";

test("bug triage blueprint captures, diagnoses, fixes, and verifies a confirmed bug", () => {
  const workflow = createBugTriageWorkflow();

  expect(workflow.name).toBe("Triage a bug");
  expect(workflow.description).toBe(
    "Capture a bug report, reproduce the behavior, plan and implement a fix, then verify the result.",
  );
  expect(workflow.activities.map((activity) => activity.activityId)).toEqual([
    "intake",
    "reproduce",
    "diagnose",
    "implement",
    "review",
  ]);
  expect(workflow.activities.map((activity) => activity.humanInput)).toEqual([
    "input",
    "off",
    "approval",
    "off",
    "approval",
  ]);
  expect(workflow.activities[1]!.outcomes).toEqual([
    { name: "confirmed_bug", handoff: { targetActivityId: "diagnose", continuation: "automatic" } },
    { name: "needs_information", handoff: { targetActivityId: "intake", continuation: "approval" } },
    { name: "expected_behavior", handoff: { targetActivityId: null, continuation: "approval" } },
  ]);
  expect(workflow.activities[4]!.outcomes).toEqual([
    { name: "fixed", handoff: { targetActivityId: null, continuation: "approval" } },
    { name: "changes_requested", handoff: { targetActivityId: "implement", continuation: "automatic" } },
  ]);
});
