import type { Activity } from "../../workflow-definition/domain/WorkflowDefinition";
import type { CompletionContract } from "../../workflow-execution/domain/WorkflowRun";
export function validateCompletion(
  activity: Activity,
  completion: CompletionContract,
): string | null {
  if (!activity.outcomes.some((outcome) => outcome.name === completion.outcome))
    return `Undeclared outcome: ${completion.outcome}`;
  return null;
}
