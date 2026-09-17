import { expect, test } from "bun:test";
import { createWorkflowDraft } from "./createWorkflowDraft";

test("workflow draft applies the entered metadata to the selected template", () => {
  const draft = createWorkflowDraft(
    "bug-triage",
    "workflow-1",
    "Production bug triage",
    "A workflow for investigating production defects.",
  );

  expect(draft.workflowId).toBe("workflow-1");
  expect(draft.name).toBe("Production bug triage");
  expect(draft.description).toBe("A workflow for investigating production defects.");
  expect(draft.activities.map((activity) => activity.activityId)).toEqual([
    "intake",
    "reproduce",
    "diagnose",
    "implement",
    "review",
  ]);
});
