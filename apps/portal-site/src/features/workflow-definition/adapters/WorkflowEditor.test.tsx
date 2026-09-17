import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { WorkflowEditor } from "./WorkflowEditor";
test("workflow editor renders a graph-first shell with readonly metadata and an inspector", () => {
  const html = renderToString(
    <WorkflowEditor
      definition={{
        workflowId: "build",
        name: "Build feature",
        description: "A feature workflow",
        positions: { plan: { x: 10, y: 20 } },
        activities: [
          {
            activityId: "plan",
            name: "Plan",
            description: "UI note",
            instructions: "Plan changes",
            execution: { kind: "agent", harness: "codex", model: "gpt-5.6-sol", effort: "medium" },
            humanInput: "approval",
            outcomes: [{ name: "ready", handoff: { targetActivityId: null, continuation: "approval" } }],
          },
        ],
      }}
      onSave={async (draft) => draft}
    />,
  );
  for (const text of [
    "Edit workflow",
    "Workflow name",
    "Workflow description",
    "Edit workflow metadata",
    "Add step",
    "Save workflow",
    "Step details",
    "Select a step or outcome to edit.",
    "Plan",
    "ready",
  ])
    expect(html).toContain(text);

  expect(html).not.toContain('placeholder="What is this workflow for?"');
  expect(html.indexOf("Add step")).toBeLessThan(html.indexOf("Workflow graph"));
});

test("graph editor renders a persisted workflow without stored positions", () => {
  const persistedDefinition = JSON.parse(`{
    "workflowId": "legacy-build",
    "name": "Build a feature",
    "description": "",
    "activities": [{
      "activityId": "requirements",
      "name": "Establish requirements",
      "description": "",
      "instructions": "Establish requirements",
      "execution": {"kind": "agent", "harness": "codex", "model": "gpt-5.6-sol", "effort": "medium"},
      "humanInput": "input",
      "outcomes": [{"name": "ready", "handoff": {"targetActivityId": null, "continuation": "automatic"}}]
    }]
  }`);

  const html = renderToString(
    <WorkflowEditor definition={persistedDefinition} onSave={async (draft) => draft} />,
  );

  expect(html).toContain("Establish requirements");
});
