import type {
  WorkflowRun,
  WorkflowMessage,
  WorkflowTransition,
} from "@factory/workflow";
export function createWorkflowRecoveryTransition(
  previous: WorkflowRun,
  message: WorkflowMessage,
  error: unknown,
  now: string,
): WorkflowTransition {
  const run = structuredClone(previous);
  const messageId =
    message.kind === "human"
      ? message.response.messageId
      : message.kind === "fact"
        ? message.fact.factId
        : message.messageId;
  const detail = `Workflow interpretation failed: ${error instanceof Error ? error.message : String(error)}. Inspect the persisted definition and execution before retrying, or cancel.`;
  const execution = run.executions.at(-1);
  const interactionId = `${run.runId}:${messageId}:interpreter-recovery`;
  run.status = "recovery-required";
  run.error = detail;
  run.updatedAt = now;
  if (!run.processedMessageIds.includes(messageId))
    run.processedMessageIds.push(messageId);
  if (execution) {
    execution.status = "failed";
    execution.error = detail;
    execution.transcript.push({
      entryId: interactionId,
      role: "system",
      content: JSON.stringify(message),
      createdAt: now,
    });
  }
  run.interaction = {
    interactionId,
    executionId: execution?.executionId ?? `${run.runId}:coordinator`,
    kind: "recovery",
    prompt: detail,
    outputRevisionIds: [...(execution?.outputRevisionIds ?? [])],
    targetActivityId: null,
  };
  return {
    run,
    commands: [],
    notifications: [
      {
        notificationId: `${interactionId}:notification`,
        runId: run.runId,
        recipientId: run.recipientId,
        kind: "recovery",
        title: run.name,
        body: detail,
        url: `/workflow-runs/${encodeURIComponent(run.runId)}`,
      },
    ],
  };
}
