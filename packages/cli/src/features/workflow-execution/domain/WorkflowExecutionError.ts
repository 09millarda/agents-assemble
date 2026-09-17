import type { WorkspaceResult } from "@factory/workflow";
export class WorkflowExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly workspaceResult?: WorkspaceResult,
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}
