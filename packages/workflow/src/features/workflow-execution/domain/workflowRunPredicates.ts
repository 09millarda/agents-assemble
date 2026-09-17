import type { ActivityExecution, WorkflowRun } from "./WorkflowRun";

type WorkflowRunStatus = WorkflowRun["status"];

const ACTIVE_WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  "queued",
  "running",
  "awaiting-human",
  "recovery-required",
];

const ATTENTION_REQUIRED_WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  "awaiting-human",
  "recovery-required",
];

const TERMINAL_WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  "completed",
  "cancelled",
  "failed",
];

export function isWorkflowRunActive(status: WorkflowRunStatus): boolean {
  return ACTIVE_WORKFLOW_RUN_STATUSES.includes(status);
}

export function isWorkflowRunAwaitingAttention(
  status: WorkflowRunStatus,
): boolean {
  return ATTENTION_REQUIRED_WORKFLOW_RUN_STATUSES.includes(status);
}

export function isWorkflowRunTerminal(status: WorkflowRunStatus): boolean {
  return TERMINAL_WORKFLOW_RUN_STATUSES.includes(status);
}

export function hasRequiredDocumentBindings(
  _run: WorkflowRun,
  _execution: ActivityExecution,
): boolean {
  return true;
}
