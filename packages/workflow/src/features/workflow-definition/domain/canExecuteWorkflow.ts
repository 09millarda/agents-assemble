import {
  isSupportedModelEffort,
  type WorkflowDefinition,
} from "./WorkflowDefinition";
export function canExecuteWorkflow(workflow: WorkflowDefinition): boolean {
  return workflow.activities.every((activity) =>
    isSupportedModelEffort(
      activity.execution.model,
      activity.execution.effort,
    ),
  );
}
