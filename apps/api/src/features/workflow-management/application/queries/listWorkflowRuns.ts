import type { WorkflowRun } from "@factory/workflow";
import type { WorkflowRunPort } from "../../domain/WorkflowStorePort";
export function listWorkflowRuns(
  store: WorkflowRunPort,
  projectId?: string,
): Promise<WorkflowRun[]> {
  return store.listRuns(projectId);
}
