import type { WorkflowDaemonCommand } from "@factory/workflow";
import type { ExecutionJournalRecord } from "./ExecutionJournalPort";
export function canReplayCommand(record: ExecutionJournalRecord): boolean {
  return ["completed", "running", "waiting"].includes(record.state);
}
export function hasInterruptedCommand(record: ExecutionJournalRecord): boolean {
  return record.state === "interrupted";
}
export function isCancellationCommand(command: WorkflowDaemonCommand): boolean {
  return command.kind === "cancel";
}
export function isReconciliationCommand(
  command: WorkflowDaemonCommand,
): boolean {
  return command.kind === "reconcile";
}
export function isAgentActivity(command: WorkflowDaemonCommand): boolean {
  return command.activity.execution.kind === "agent";
}

export function requiresExplicitRecovery(
  command: WorkflowDaemonCommand,
  previous: ExecutionJournalRecord[],
): boolean {
  return (
    command.kind === "execute" &&
    previous.length > 0 &&
    !command.recoveryAuthorized &&
    !command.interaction
  );
}
