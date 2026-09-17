import {
  isSupportedModelEffort,
  type WorkflowDefinition,
} from "./WorkflowDefinition";
import { isWorkflowStatus, validateWorkflowTags } from "./workflowLifecycle";
export function validateWorkflowDefinition(
  workflow: WorkflowDefinition,
): string | null {
  if (!isValidIdentifier(workflow.workflowId) || !workflow.name.trim())
    return "Workflow ID and name are required";
  if (!isWorkflowStatus(workflow.status))
    return "Workflow status must be draft or published";
  const invalidTags = validateWorkflowTags(workflow.tags);
  if (invalidTags) return invalidTags;
  const activityIds = workflow.activities.map(
    (activity) => activity.activityId,
  );
  if (!activityIds.every(isValidIdentifier))
    return "Activity IDs must be unique valid identifiers";
  if (new Set(activityIds).size !== activityIds.length)
    return "Activity IDs must be unique valid identifiers";
  const names = workflow.activities.map((activity) => activity.name.trim());
  if (new Set(names).size !== names.length)
    return "Step names must be unique";
  for (const activity of workflow.activities) {
    if (!activity.name.trim() || !activity.instructions.trim())
      return "Step name and instructions are required";
    if (
      activity.humanInput !== "off" &&
      activity.humanInput !== "approval" &&
      activity.humanInput !== "input"
    )
      return "Human input must be off, approval, or input";
    const execution = activity.execution;
    if (
      execution.kind !== "agent" ||
      execution.harness !== "codex" ||
      !isSupportedModelEffort(execution.model, execution.effort)
    )
      return "Model and effort must use the static codex catalogue";
    if (
      !activity.outcomes.length ||
      !areUniqueIdentifiers(activity.outcomes.map((outcome) => outcome.name))
    )
      return "Steps require unique named outcomes";
    for (const outcome of activity.outcomes) {
      const target = outcome.handoff.targetActivityId;
      if (target !== null && !activityIds.includes(target))
        return "Handoff target does not exist";
      if (
        outcome.handoff.continuation !== "automatic" &&
        outcome.handoff.continuation !== "approval"
      )
        return "Handoff continuation must be automatic or approval";
    }
  }
  return null;
}
function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,100}$/.test(value);
}
function areUniqueIdentifiers(values: string[]): boolean {
  return (
    values.every(isValidIdentifier) && new Set(values).size === values.length
  );
}
