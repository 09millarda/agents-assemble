import type {
  HumanResponse,
  WorkflowNotification,
  WorkflowRun,
} from "@factory/workflow";

export interface RunNotification extends WorkflowNotification {
  deliveryStatus: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface StartWorkflowRun {
  workflowId: string;
  projectId: string;
  requestId: string;
  kickoffPrompt?: string;
  branch?: string;
  recipientId?: string;
  managementToken?: string;
}
export interface WorkflowRunPort {
  startRun(input: StartWorkflowRun): Promise<WorkflowRun>;
  listRuns(projectId?: string): Promise<WorkflowRun[]>;
  getRun(runId: string): Promise<WorkflowRun>;
  listNotifications(runId: string): Promise<RunNotification[]>;
  submitCommand(response: HumanResponse): Promise<void>;
  deleteRun(runId: string): Promise<void>;
}
