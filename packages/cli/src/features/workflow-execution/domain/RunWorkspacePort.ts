import type {
  BoundDocument,
  RunWorkspace,
  WorkspaceResult,
} from "@factory/workflow";
export interface RunWorkspacePort {
  cancel(runId: string): Promise<void>;
  prepare(
    runId: string,
    workspace: RunWorkspace,
    recoveryAuthorized?: boolean,
  ): Promise<WorkspaceResult>;
  materialize(
    runId: string,
    executionId: string,
    documents: BoundDocument[],
  ): Promise<string>;
  inspect(workspace: WorkspaceResult): Promise<WorkspaceResult>;
}
