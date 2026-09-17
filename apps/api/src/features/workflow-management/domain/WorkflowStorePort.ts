import type {
  DocumentRevision,
  HarnessCapability,
  HumanResponse,
  WorkflowDefinition,
  WorkflowMessage,
  WorkflowNotification,
  WorkflowRun,
} from "@factory/workflow";
import type { ProjectInfo } from "@factory/shared-domain";
export interface WorkflowCatalogPort {
  saveDefinition(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
  deleteDefinition(workflowId: string): Promise<boolean>;
  findDefinition(workflowId: string): Promise<WorkflowDefinition | null>;
  listDefinitions(): Promise<WorkflowDefinition[]>;
}
export interface BrowserRecipient {
  recipientId: string;
  active: boolean;
  deliveryStatus: string;
  lastDeliveryError?: string | null;
  vapidPublicKey: string | null;
}
export interface PushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}
export interface BrowserRecipientPort {
  createRecipient(): Promise<BrowserRecipient & { managementToken: string }>;
  authorizeRecipient(recipientId: string, token: string): Promise<boolean>;
  findRecipient(recipientId: string): Promise<BrowserRecipient | null>;
  replaceSubscription(
    recipientId: string,
    subscription: PushSubscription | null,
  ): Promise<BrowserRecipient>;
}
export interface WorkflowNotificationRecord extends WorkflowNotification {
  deliveryStatus: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}
export interface WorkflowRunPort {
  listNotifications(runId: string): Promise<WorkflowNotificationRecord[]>;
  findCapabilities(daemonId: string): Promise<HarnessCapability[]>;
  findProject(projectId: string): Promise<ProjectInfo | null>;
  createRun(run: WorkflowRun): Promise<WorkflowRun>;
  findRun(runId: string): Promise<WorkflowRun | null>;
  listRuns(projectId?: string): Promise<WorkflowRun[]>;
  submitMessage(
    runId: string,
    messageId: string,
    message: WorkflowMessage,
  ): Promise<"accepted" | "duplicate" | "conflict">;
  findDocument(revisionId: string): Promise<DocumentRevision | null>;
}
export type WorkflowStorePort = WorkflowCatalogPort &
  WorkflowRunPort &
  BrowserRecipientPort;
export type StartWorkflowRunInput = {
  requestId: string;
  workflowId: string;
  projectId: string;
  kickoffPrompt?: string;
  branch?: string;
  recipientId?: string;
  managementToken?: string;
};
export type WorkflowError = { code: string; message: string };
