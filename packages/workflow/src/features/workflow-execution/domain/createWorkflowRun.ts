import type { WorkflowDefinition } from "../../workflow-definition/domain/WorkflowDefinition";
import type { WorkflowRun, RunWorkspace } from "./WorkflowRun";
export interface StartWorkflowInput {
  runId: string;
  name?: string;
  projectId: string;
  daemonId: string;
  workflow: WorkflowDefinition;
  workspace: RunWorkspace;
  recipientId?: string;
  prompt?: string;
}
export function createWorkflowRun(
  input: StartWorkflowInput,
  now: string,
): WorkflowRun {
  return {
    runId: input.runId,
    name: input.name ?? input.workflow.name,
    projectId: input.projectId,
    workflowId: input.workflow.workflowId,
    daemonId: input.daemonId,
    recipientId: input.recipientId ?? null,
    snapshot: structuredClone(input.workflow),
    workspace: { ...structuredClone(input.workspace) },
    workspaceResult: null,
    kickoffPrompt: input.prompt?.trim() || null,
    status: "queued",
    executions: [],
    documents: [],
    interaction: null,
    loopPasses: {},
    loopLimits: {},
    processedMessageIds: [],
    approvedTreeHash: null,
    acceptedFindings: false,
    acceptedFindingRevisionIds: [],
    publication: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}
