import type { WorkflowDaemonCommand, WorkspaceResult } from "@factory/workflow";
export interface PullRequestPublicationPort {
  cancel(runId: string): Promise<void>;
  publish(
    command: WorkflowDaemonCommand,
    workspace: WorkspaceResult,
  ): Promise<{ url: string; number?: number }>;
}
