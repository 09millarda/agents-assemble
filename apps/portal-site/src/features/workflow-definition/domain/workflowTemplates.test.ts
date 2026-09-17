import { expect, test } from "bun:test";
import { createWorkflowFromTemplate, WORKFLOW_TEMPLATES } from "./workflowTemplates";

test("workflow templates expose blank, feature-building, and bug-triage choices", () => {
  expect(WORKFLOW_TEMPLATES.map((template) => template.id)).toEqual([
    "blank",
    "feature-building",
    "bug-triage",
  ]);
  expect(WORKFLOW_TEMPLATES.map((template) => template.name)).toEqual([
    "Blank",
    "Feature building",
    "Bug triage",
  ]);
  expect(createWorkflowFromTemplate("blank").activities).toEqual([]);
  expect(createWorkflowFromTemplate("bug-triage").activities.map((activity) => activity.name)).toEqual([
    "Capture bug report",
    "Reproduce and isolate",
    "Diagnose and plan fix",
    "Implement the fix",
    "Verify the fix",
  ]);
});
