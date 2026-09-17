import type {
  WorkflowTransition,
  ActivityExecution,
  WorkflowDaemonCommand,
} from "./WorkflowRun";
import { buildCommand } from "./buildWorkflowDaemonCommand";
export function startActivity(
  transition: WorkflowTransition,
  activityId: string,
  now: string,
): void {
  const run = transition.run;
  const activity = run.snapshot.activities.find(
    (candidate) => candidate.activityId === activityId,
  );
  if (!activity) return;
  const executionId = `${run.runId}:execution:${run.executions.length + 1}`;
  const execution: ActivityExecution = {
    executionId,
    activityId,
    activity: structuredClone(activity),
    status: "running",
    inputRevisionIds: [],
    outputRevisionIds: [],
    sessionId: null,
    transcript: [],
    dispatchSequence: 1,
    harnessTurnIds: [],
    recoveryAttempt: 0,
    commandId: `${executionId}:dispatch:1:attempt:0`,
    outcome: null,
    error: null,
  };
  run.executions.push(execution);
  run.status = "running";
  run.updatedAt = now;
  dispatchActivityExecution(transition, execution, now);
}
export function dispatchActivityExecution(
  transition: WorkflowTransition,
  execution: ActivityExecution,
  now: string,
  command?: WorkflowDaemonCommand,
): void {
  transition.commands.push(command ?? buildCommand(transition.run, execution, "execute"));
}
export function continueToActivity(
  transition: WorkflowTransition,
  target: string | null,
  now: string,
): void {
  if (target) startActivity(transition, target, now);
  else {
    transition.run.status = "completed";
    transition.run.interaction = null;
  }
}
export function completeActivityHandoff(
  transition: WorkflowTransition,
  execution: ActivityExecution,
  now: string,
): void {
  const run = transition.run;
  const handoff = execution.activity.outcomes.find(
    (outcome) => outcome.name === execution.outcome,
  )?.handoff;
  if (handoff?.continuation === "approval") {
    run.status = "awaiting-human";
    run.interaction = {
      interactionId: `${execution.commandId}:approval`,
      executionId: execution.executionId,
      kind: "approval",
      prompt: `Approve ${execution.activity.name}`,
      outputRevisionIds: [...execution.outputRevisionIds],
      targetActivityId: handoff.targetActivityId,
      reviewedTreeHash: run.workspaceResult?.treeHash,
    };
  } else continueToActivity(transition, handoff?.targetActivityId ?? null, now);
}
