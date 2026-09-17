import type { WorkflowDaemonCommand, WorkspaceResult } from "@factory/workflow";
import type { PullRequestPublicationPort } from "../domain/PullRequestPublicationPort";
import type { runLocalProcess } from "./runLocalProcess";
export class GitHubCliPublicationAdapter implements PullRequestPublicationPort {
  private readonly activeRuns = new Map<string, AbortController>();
  async cancel(runId: string): Promise<void> {
    this.activeRuns.get(runId)?.abort();
  }
  constructor(
    private readonly directory: string,
    private readonly execute: typeof runLocalProcess,
    private readonly inspectWorkspace: (
      workspace: WorkspaceResult,
    ) => Promise<WorkspaceResult>,
  ) {}
  async publish(
    _command: WorkflowDaemonCommand,
    _workspace: WorkspaceResult,
  ): Promise<{ url: string; number?: number }> {
    throw new Error("Publication was removed with built-in actions.");
  }
}
