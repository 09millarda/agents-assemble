import {
  WORKFLOW_DEFAULT_EFFORT,
  WORKFLOW_DEFAULT_MODEL,
  type Activity,
  type ActivityOutcome,
  type WorkflowDefinition,
} from "@factory/workflow";
import type { GraphEdgeRef } from "./WorkflowGraph";

export function cloneWorkflowEditorDraft(definition: WorkflowDefinition): WorkflowDefinition {
  return structuredClone({
    ...definition,
    positions: definition.positions ?? {},
  });
}

export function hasWorkflowDraftChanges(draft: WorkflowDefinition, lastSavedDraft: WorkflowDefinition): boolean {
  return JSON.stringify(draft) !== JSON.stringify(lastSavedDraft);
}

export function createWorkflowActivity(activityId: string): Activity {
  return {
    activityId,
    name: "New step",
    description: "",
    instructions: "",
    execution: { kind: "agent", harness: "codex", model: WORKFLOW_DEFAULT_MODEL, effort: WORKFLOW_DEFAULT_EFFORT },
    humanInput: "off",
    outcomes: [{ name: "done", handoff: { targetActivityId: null, continuation: "automatic" } }],
  };
}

export function removeActivityFromWorkflow(definition: WorkflowDefinition, activityId: string): WorkflowDefinition {
  return {
    ...definition,
    activities: definition.activities
      .filter((activity) => activity.activityId !== activityId)
      .map((activity) => ({
        ...activity,
        outcomes: activity.outcomes.map((outcome) =>
          outcome.handoff.targetActivityId === activityId
            ? { ...outcome, handoff: { ...outcome.handoff, targetActivityId: null } }
            : outcome,
        ),
      })),
    positions: Object.fromEntries(Object.entries(definition.positions).filter(([candidateId]) => candidateId !== activityId)),
  };
}

export function connectWorkflowActivities(definition: WorkflowDefinition, sourceActivityId: string, targetActivityId: string): WorkflowDefinition {
  return {
    ...definition,
    activities: definition.activities.map((activity) => {
      if (activity.activityId !== sourceActivityId) return activity;
      const terminalOutcomeIndex = activity.outcomes.findIndex((outcome) => !outcome.handoff.targetActivityId);
      const outcomes = terminalOutcomeIndex >= 0
        ? activity.outcomes.map((outcome, index) => index === terminalOutcomeIndex ? { ...outcome, handoff: { ...outcome.handoff, targetActivityId: targetActivityId } } : outcome)
        : [...activity.outcomes, { name: `to-${activity.outcomes.length + 1}`, handoff: { targetActivityId, continuation: "automatic" as const } }];
      return { ...activity, outcomes };
    }),
  };
}

export function updateWorkflowOutcome(definition: WorkflowDefinition, edge: GraphEdgeRef, outcome: ActivityOutcome): WorkflowDefinition {
  return {
    ...definition,
    activities: definition.activities.map((activity) => activity.activityId !== edge.sourceActivityId
      ? activity
      : { ...activity, outcomes: activity.outcomes.map((candidate) => candidate.name === edge.outcomeName ? outcome : candidate) }),
  };
}

export function removeWorkflowOutcome(definition: WorkflowDefinition, edge: GraphEdgeRef): WorkflowDefinition {
  return {
    ...definition,
    activities: definition.activities.map((activity) => {
      if (activity.activityId !== edge.sourceActivityId || activity.outcomes.length <= 1) return activity;
      return { ...activity, outcomes: activity.outcomes.filter((outcome) => outcome.name !== edge.outcomeName) };
    }),
  };
}
