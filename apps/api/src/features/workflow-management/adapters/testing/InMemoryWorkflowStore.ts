import type {
  DocumentRevision,
  WorkflowDefinition,
  WorkflowMessage,
  WorkflowRun,
} from "@factory/workflow";
import type { ProjectInfo } from "@factory/shared-domain";
import type {
  BrowserRecipient,
  PushSubscription,
  WorkflowStorePort,
} from "../../domain/WorkflowStorePort";
export class InMemoryWorkflowStore implements WorkflowStorePort {
  definitions = new Map<string, WorkflowDefinition>();
  projects = new Map<string, ProjectInfo>();
  runs = new Map<string, WorkflowRun>();
  enqueuedRunIds: string[] = [];
  messages = new Map<string, WorkflowMessage>();
  recipients = new Map<string, BrowserRecipient>();
  async saveDefinition(value: WorkflowDefinition) {
    this.definitions.set(value.workflowId, structuredClone(value));
    return value;
  }
  async deleteDefinition(workflowId: string) {
    const deleted = this.definitions.delete(workflowId);
    if (!deleted) return false;
    for (const [projectId, project] of this.projects) {
      this.projects.set(projectId, {
        ...project,
        enabledWorkflowIds: project.enabledWorkflowIds.filter(
          (enabledWorkflowId) => enabledWorkflowId !== workflowId,
        ),
      });
    }
    return true;
  }
  async findDefinition(id: string) {
    return this.definitions.get(id) ?? null;
  }
  async listDefinitions() {
    return [...this.definitions.values()];
  }
  async findCapabilities(id: string) {
    return [
      {
        harness: "codex" as const,
        version: "supported",
        models: [{ model: "available-model", efforts: ["high"] }],
        questions: true,
        permissions: true,
        structuredOutput: true,
      },
    ];
  }
  async listNotifications(runId:string){return [];}
  async findProject(id: string) {
    return this.projects.get(id) ?? null;
  }
  async createRun(value: WorkflowRun) {
    if (!this.runs.has(value.runId)) {
      this.runs.set(value.runId, structuredClone(value));
      this.enqueuedRunIds.push(value.runId);
    }
    return this.runs.get(value.runId)!;
  }
  async findRun(id: string) {
    return structuredClone(this.runs.get(id) ?? null);
  }
  async listRuns(projectId?: string) {
    return [...this.runs.values()].filter(
      (run) => !projectId || run.projectId === projectId,
    );
  }
  async submitMessage(
    runId: string,
    id: string,
    message: WorkflowMessage,
  ): Promise<"accepted" | "duplicate" | "conflict"> {
    const existing = this.messages.get(id);
    if (existing)
      return JSON.stringify(existing) === JSON.stringify(message)
        ? "duplicate"
        : "conflict";
    this.messages.set(id, message);
    return "accepted";
  }
  async findDocument(id: string) {
    return (
      [...this.runs.values()]
        .flatMap((run) => run.documents)
        .find((document) => document.revisionId === id) ?? null
    );
  }
  async createRecipient() {
    const recipient = {
      recipientId: "browser-" + this.recipients.size,
      active: true,
      deliveryStatus: "unenrolled",
      vapidPublicKey: null,
    };
    this.recipients.set(recipient.recipientId, recipient);
    return { ...recipient, managementToken: "test-management-token" };
  }
  async authorizeRecipient(id: string, token: string) {
    return this.recipients.has(id) && token === "test-management-token";
  }
  async findRecipient(id: string) {
    return this.recipients.get(id) ?? null;
  }
  async replaceSubscription(id: string, subscription: PushSubscription | null) {
    const recipient = {
      ...this.recipients.get(id)!,
      active: !!subscription,
      deliveryStatus: subscription ? "enrolled" : "unenrolled",
    };
    this.recipients.set(id, recipient);
    return recipient;
  }
}
