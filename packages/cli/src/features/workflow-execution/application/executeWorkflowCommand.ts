import { WorkflowExecutionError } from "../domain/WorkflowExecutionError";
import type {
  WorkflowDaemonCommand,
  WorkflowDaemonFact,
} from "@factory/workflow";
import type { ExecutionJournalPort } from "../domain/ExecutionJournalPort";
import type { HarnessExecutionPort } from "../domain/HarnessExecutionPort";
import type { RunWorkspacePort } from "../domain/RunWorkspacePort";
import type { PullRequestPublicationPort } from "../domain/PullRequestPublicationPort";
import {
  canReplayCommand,
  hasInterruptedCommand,
  isCancellationCommand,
  isReconciliationCommand,
  requiresExplicitRecovery,
} from "../domain/workflowCommandPredicates";

export interface WorkflowExecutionPorts {
  journal: ExecutionJournalPort;
  harness: HarnessExecutionPort;
  workspace: RunWorkspacePort;
  publisher: PullRequestPublicationPort;
}
export async function executeWorkflowCommand(
  command: WorkflowDaemonCommand,
  ports: WorkflowExecutionPorts,
  emit: (fact: WorkflowDaemonFact) => Promise<void>,
): Promise<void> {
  const record = await ports.journal.receive(
    command.commandId,
    command.executionId,
    command.runId,
  );
  for (const fact of record.facts)
    await emit(fact as unknown as WorkflowDaemonFact);
  if (canReplayCommand(record)) return;
  let sequence = record.facts.length;
  const publish = async (
    payload: Omit<
      WorkflowDaemonFact,
      "factId" | "commandId" | "executionId" | "runId"
    >,
    terminal = false,
  ) => {
    const fact: WorkflowDaemonFact = {
      ...payload,
      factId: `${command.commandId}:${sequence++}`,
      commandId: command.commandId,
      executionId: command.executionId,
      runId: command.runId,
    };
    if (terminal)
      await ports.journal.finish(
        command.commandId,
        fact as unknown as Record<string, unknown>,
      );
    else
      await ports.journal.append(
        command.commandId,
        fact as unknown as Record<string, unknown>,
      );
    await emit(fact);
  };
  const prior = (await ports.journal.findExecution(command.executionId)).filter(
    (entry) => entry.commandId !== command.commandId,
  );
  if (isReconciliationCommand(command)) {
    const completion = prior
      .at(-1)
      ?.facts.filter((fact) => fact.type === "completed")
      .at(-1);
    if (completion) {
      const {
        factId: _factId,
        commandId: _commandId,
        executionId: _executionId,
        runId: _runId,
        ...payload
      } = completion;
      await publish(
        payload as unknown as Omit<
          WorkflowDaemonFact,
          "factId" | "commandId" | "executionId" | "runId"
        >,
        true,
      );
      return;
    }
  }
  if (
    hasInterruptedCommand(record) ||
    isReconciliationCommand(command) ||
    requiresExplicitRecovery(command, prior)
  ) {
    await publish(
      {
        type: "recovery_required",
        message:
          "Execution was interrupted. Reconcile preserved work before explicitly retrying or cancelling.",
      },
      true,
    );
    return;
  }
  await ports.journal.begin(command.commandId);
  await publish({ type: "received" });
  if (isCancellationCommand(command)) {
    await ports.publisher.cancel(command.runId);
    await ports.workspace.cancel(command.runId);
    await ports.harness.cancel(command.executionId);
    await publish(
      {
        type: "cancelled",
        message: "Execution cancelled; worktree and documents retained.",
      },
      true,
    );
    return;
  }
  try {
    const workspace =
      command.workspaceResult ??
      (await ports.workspace.prepare(
        command.runId,
        command.workspace,
        command.recoveryAuthorized,
      ));
    const inputsPath = await ports.workspace.materialize(
      command.runId,
      command.executionId,
      command.documents,
    );
    const result = await ports.harness.execute(
      command,
      workspace,
      inputsPath,
      async (event) => {
        await publish({ ...event, workspaceResult: workspace });
      },
    );
    if (result.status === "waiting") {
      await ports.journal.wait(command.commandId, result.sessionId);
      return;
    }
    await publish(
      {
        type: "completed",
        sessionId: result.sessionId,
        harnessTurnId: result.harnessTurnId,
        completion: result.completion,
        workspaceResult: await ports.workspace.inspect(workspace),
      },
      true,
    );
  } catch (error) {
    await publish(
      {
        type: "failed",
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof WorkflowExecutionError
          ? { code: error.code, workspaceResult: error.workspaceResult }
          : {}),
      },
      true,
    );
  }
}
