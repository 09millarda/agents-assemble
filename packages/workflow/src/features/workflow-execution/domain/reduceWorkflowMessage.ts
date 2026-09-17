import type {
  WorkflowRun,
  WorkflowMessage,
  WorkflowTransition,
} from "./WorkflowRun";
import { findWorkflowStartActivityId } from "../../workflow-definition/domain/WorkflowDefinition";
import { startActivity } from "./workflowActivityProgression";
import { acceptWorkflowFact } from "./acceptWorkflowFact";
import { answerWorkflowInteraction } from "./answerWorkflowInteraction";
export function reduceWorkflowMessage(
  previous: WorkflowRun,
  message: WorkflowMessage,
  now: string,
): WorkflowTransition {
  const run = structuredClone(previous);
  const transition: WorkflowTransition = {
    run,
    commands: [],
    notifications: [],
  };
  const messageId =
    message.kind === "human"
      ? message.response.messageId
      : message.kind === "fact"
        ? message.fact.factId
        : message.messageId;
  if (
    run.processedMessageIds.includes(messageId) ||
    ["cancelled", "completed", "failed"].includes(run.status)
  )
    return transition;
  run.processedMessageIds.push(messageId);
  const execution = run.executions.at(-1);
  if (
    message.kind === "fact" &&
    execution &&
    message.fact.commandId === execution.commandId &&
    message.fact.executionId === execution.executionId &&
    message.fact.runId === run.runId
  )
    acceptWorkflowFact(transition, message.fact, now);
  if (message.kind === "human")
    answerWorkflowInteraction(transition, message.response, now);
  if (message.kind === "start" && run.status === "queued") {
    const startId = findWorkflowStartActivityId(run.snapshot);
    if (!startId) {
      run.status = "completed";
      run.updatedAt = now;
    } else startActivity(transition, startId, now);
  }
  return transition;
}
