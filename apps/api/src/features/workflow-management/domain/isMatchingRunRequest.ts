import type { WorkflowRun } from "@factory/workflow";
import type { StartWorkflowRunInput } from "./WorkflowStorePort";
export function isMatchingRunRequest(
  run: WorkflowRun,
  input: StartWorkflowRunInput,
): boolean {
  return (
    run.projectId === input.projectId &&
    run.workflowId === input.workflowId &&
    run.kickoffPrompt === (input.kickoffPrompt?.trim() || null) &&
    (run.workspace.branch ?? null) === (input.branch ?? null) &&
    run.recipientId === (input.recipientId ?? null)
  );
}
