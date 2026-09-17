import type {
  WorkflowRun,
  WorkflowDaemonCommand,
  ActivityExecution,
} from "./WorkflowRun";
export function buildCommand(
  run: WorkflowRun,
  execution: ActivityExecution,
  kind: WorkflowDaemonCommand["kind"],
): WorkflowDaemonCommand {
  return {
    commandId: execution.commandId,
    runId: run.runId,
    executionId: execution.executionId,
    daemonId: run.daemonId,
    kind,
    sessionId: execution.sessionId ?? undefined,
    activity: execution.activity,
    workspace: run.workspace,
    workspaceResult: run.workspaceResult ?? undefined,
    approvedTreeHash: run.approvedTreeHash ?? undefined,
    acceptedFindings: run.acceptedFindings,
    acceptedFindingsDocuments: [],
    documents: [],
    documentContracts: [],
    kickoffPrompt: run.kickoffPrompt,
  };
}
