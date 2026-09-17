import { expect, test } from "bun:test";
import type { WorkflowDefinition } from "@factory/workflow";
import {
  cloneWorkflowEditorDraft,
  connectWorkflowActivities,
  createWorkflowActivity,
  hasWorkflowDraftChanges,
  removeActivityFromWorkflow,
  removeWorkflowOutcome,
  updateWorkflowOutcome,
} from "./workflowEditorDraft";

function createDefinition(): WorkflowDefinition {
  return {
    workflowId: "build",
    name: "Build feature",
    description: "A feature workflow",
    status: "draft",
    tags: [],
    positions: { plan: { x: 10, y: 20 }, implement: { x: 300, y: 20 } },
    activities: [
      {
        activityId: "plan",
        name: "Plan",
        description: "",
        instructions: "Plan changes",
        execution: { kind: "agent", harness: "codex", model: "gpt-5.6-sol", effort: "medium" },
        humanInput: "off",
        outcomes: [{ name: "ready", handoff: { targetActivityId: "implement", continuation: "automatic" } }],
      },
      {
        activityId: "implement",
        name: "Implement",
        description: "",
        instructions: "Implement changes",
        execution: { kind: "agent", harness: "codex", model: "gpt-5.6-sol", effort: "medium" },
        humanInput: "off",
        outcomes: [{ name: "done", handoff: { targetActivityId: null, continuation: "automatic" } }],
      },
    ],
  };
}

test("new workflow activities start with a valid default outcome and editable instructions", () => {
  expect(createWorkflowActivity("review")).toEqual({
    activityId: "review",
    name: "New step",
    description: "",
    instructions: "",
    execution: { kind: "agent", harness: "codex", model: "gpt-5.6-sol", effort: "medium" },
    humanInput: "off",
    outcomes: [{ name: "done", handoff: { targetActivityId: null, continuation: "automatic" } }],
  });
});

test("removing a step removes its position and turns incoming handoffs into terminal outcomes", () => {
  const nextDefinition = removeActivityFromWorkflow(createDefinition(), "implement");
  expect(nextDefinition.positions).toEqual({ plan: { x: 10, y: 20 } });
  expect(nextDefinition.activities).toHaveLength(1);
  expect(nextDefinition.activities[0]!.outcomes[0]!.handoff.targetActivityId).toBeNull();
});

test("connecting activities fills the terminal outcome before creating a new handoff", () => {
  const definition = createDefinition();
  const connectedDefinition = connectWorkflowActivities(definition, "implement", "plan");
  expect(connectedDefinition.activities[1]!.outcomes[0]!.handoff.targetActivityId).toBe("plan");

  const branchedDefinition = connectWorkflowActivities(connectedDefinition, "implement", "plan");
  expect(branchedDefinition.activities[1]!.outcomes).toHaveLength(2);
  expect(branchedDefinition.activities[1]!.outcomes[1]!.name).toBe("to-2");
});

test("updating and removing outcomes preserves the selected handoff semantics", () => {
  const definition = createDefinition();
  const edge = { sourceActivityId: "implement", outcomeName: "done" };
  const updatedDefinition = updateWorkflowOutcome(definition, edge, {
    name: "published",
    handoff: { targetActivityId: "plan", continuation: "approval" },
  });
  expect(updatedDefinition.activities[1]!.outcomes[0]).toEqual({
    name: "published",
    handoff: { targetActivityId: "plan", continuation: "approval" },
  });

  const removedDefinition = removeWorkflowOutcome(updatedDefinition, { sourceActivityId: "plan", outcomeName: "ready" });
  expect(removedDefinition.activities[0]!.outcomes).toHaveLength(1);
});

test("dirty state compares normalized editor drafts without sharing references", () => {
  const original = createDefinition();
  const cloned = cloneWorkflowEditorDraft(original);
  expect(hasWorkflowDraftChanges(cloned, original)).toBe(false);
  cloned.name = "Changed workflow";
  expect(hasWorkflowDraftChanges(cloned, original)).toBe(true);
  expect(original.name).toBe("Build feature");
});
