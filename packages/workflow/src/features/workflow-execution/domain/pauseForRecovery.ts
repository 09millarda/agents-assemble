import type { WorkflowTransition, ActivityExecution } from "./WorkflowRun";
export function pauseForRecovery(
  transition: WorkflowTransition,
  execution: ActivityExecution,
  error: string,
): void {
  const run = transition.run;
  run.status = "recovery-required";
  run.error = error;
  execution.error = error;
  execution.status = "failed";
  run.interaction = {
    interactionId: `${execution.commandId}:recovery`,
    executionId: execution.executionId,
    kind: "recovery",
    prompt: error,
    outputRevisionIds: [...execution.outputRevisionIds],
    targetActivityId: null,
  };
}
