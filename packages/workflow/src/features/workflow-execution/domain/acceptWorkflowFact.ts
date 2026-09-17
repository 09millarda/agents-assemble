import { validateCompletion } from "../../context-document/domain/validateCompletion";
import type { WorkflowTransition, WorkflowDaemonFact } from "./WorkflowRun";
import { completeActivityHandoff } from "./workflowActivityProgression";
import { pauseForRecovery } from "./pauseForRecovery";
export function acceptWorkflowFact(
  transition: WorkflowTransition,
  fact: WorkflowDaemonFact,
  now: string,
): void {
  const run = transition.run;
  const execution = run.executions.at(-1)!;
  if (["completed", "cancelled", "failed"].includes(execution.status)) return;
  if (
    fact.harnessTurnId &&
    !execution.harnessTurnIds.includes(fact.harnessTurnId)
  )
    execution.harnessTurnIds.push(fact.harnessTurnId);
  if (fact.type === "progress" && fact.message)
    execution.transcript.push({
      entryId: fact.factId,
      role: "assistant",
      content: fact.message,
      createdAt: now,
    });
  if (fact.type === "failed" || fact.type === "recovery_required") {
    pauseForRecovery(transition, execution, fact.message ?? "Execution failed");
    return;
  }
  if (fact.workspaceResult) run.workspaceResult = fact.workspaceResult;
  if (fact.sessionId) execution.sessionId = fact.sessionId;
  if (
    fact.type === "completed" &&
    fact.completion &&
    execution.status === "running"
  ) {
    const invalid = validateCompletion(execution.activity, fact.completion);
    if (invalid) {
      execution.transcript.push({
        entryId: fact.factId,
        role: "system",
        content: JSON.stringify(fact.completion),
        createdAt: now,
      });
      pauseForRecovery(transition, execution, invalid);
      return;
    }
    if (fact.publication) run.publication = structuredClone(fact.publication);
    execution.outcome = fact.completion.outcome;
    execution.status = "completed";
    execution.outputRevisionIds = [];
    completeActivityHandoff(transition, execution, now);
  }
  if (fact.type === "question" && execution.activity.humanInput === "off") {
    pauseForRecovery(
      transition,
      execution,
      "This step does not accept human input",
    );
    return;
  }
  if (fact.type === "question" || fact.type === "permission") {
    execution.sessionId = fact.sessionId ?? execution.sessionId;
    execution.transcript.push({
      entryId: fact.factId,
      role: "assistant",
      content: fact.message ?? "Input required",
      createdAt: now,
    });
    execution.status = "awaiting-human";
    run.status = "awaiting-human";
    run.interaction = {
      interactionId: fact.interactionId ?? fact.factId,
      executionId: execution.executionId,
      kind: fact.type,
      prompt: fact.message ?? "Input required",
      outputRevisionIds: [],
      targetActivityId: null,
      permissionRequest: fact.permissionRequest,
    };
  }
}
