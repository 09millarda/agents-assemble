import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { WorkflowDefinition } from "@factory/workflow";
import { WorkflowInspector } from "./WorkflowInspector";

const definition: WorkflowDefinition = {
  workflowId: "build",
  name: "Build feature",
  description: "A feature workflow",
  status: "draft",
  tags: [],
  positions: {},
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
};

const noop = () => {};

test("empty inspector teaches the node and outcome selection interaction", () => {
  const html = renderToString(
    <WorkflowInspector
      definition={definition}
      selectedActivity={null}
      selectedEdge={null}
      selectedOutcome={null}
      nodeError={null}
      edgeError={null}
      focusActivityId={null}
      onFocusHandled={noop}
      onUpdateActivity={noop}
      onSelectOutcome={noop}
      onUpdateOutcome={noop}
      onAddOutcome={noop}
      onRemoveOutcome={noop}
      onRequestDeleteStep={noop}
    />,
  );

  expect(html).toContain("Select a step or outcome to edit.");
});

test("selected step inspector groups configuration and exposes outcomes", () => {
  const activity = definition.activities[0]!;
  const html = renderToString(
    <WorkflowInspector
      definition={definition}
      selectedActivity={activity}
      selectedEdge={null}
      selectedOutcome={null}
      nodeError={null}
      edgeError={null}
      focusActivityId={null}
      onFocusHandled={noop}
      onUpdateActivity={noop}
      onSelectOutcome={noop}
      onUpdateOutcome={noop}
      onAddOutcome={noop}
      onRemoveOutcome={noop}
      onRequestDeleteStep={noop}
    />,
  );

  for (const text of ["Basics", "Execution", "Instructions", "Outcomes", "ready", "Delete step"]) {
    expect(html).toContain(text);
  }
});

test("selected outcome inspector exposes the complete handoff configuration", () => {
  const activity = definition.activities[0]!;
  const outcome = activity.outcomes[0]!;
  const html = renderToString(
    <WorkflowInspector
      definition={definition}
      selectedActivity={null}
      selectedEdge={{ sourceActivityId: activity.activityId, outcomeName: outcome.name }}
      selectedOutcome={outcome}
      nodeError={null}
      edgeError={null}
      focusActivityId={null}
      onFocusHandled={noop}
      onUpdateActivity={noop}
      onSelectOutcome={noop}
      onUpdateOutcome={noop}
      onAddOutcome={noop}
      onRemoveOutcome={noop}
      onRequestDeleteStep={noop}
    />,
  );

  for (const text of ["Outcome details", "Outcome name", "Target step", "End run", "Needs approval", "Remove outcome"]) {
    expect(html).toContain(text);
  }
});
