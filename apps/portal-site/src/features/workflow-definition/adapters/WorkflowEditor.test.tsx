import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { WorkflowEditor } from "./WorkflowEditor";
test("graph editor renders steps as nodes with labelled outcome edges and side panels", () => {
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
      onSave={async () => {}}
    />,
  );
  for (const text of [
    "Workflow name",
    "Workflow description",
    "Add step",
    "Save workflow",
    "Step details",
    "Edge details",
    "Select a step node",
    "Select an edge label",
    "Plan",
    "ready",
  ])
    expect(html).toContain(text);
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
    <WorkflowEditor definition={persistedDefinition} onSave={async () => {}} />,
  );

  expect(html).toContain("Establish requirements");
});
