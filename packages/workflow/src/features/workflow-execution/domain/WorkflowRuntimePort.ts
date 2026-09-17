import type { WorkflowRun, WorkflowTransition } from "./WorkflowRun";
export interface WorkflowRuntimePort {
  findRun(runId: string): Promise<WorkflowRun | null>;
  saveTransition(transition: WorkflowTransition): Promise<void>;
}
