import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  DocumentRevision,
  HarnessCapability,
  WorkflowDefinition,
  WorkflowMessage,
  WorkflowNotification,
  WorkflowRun,
} from "@factory/workflow";
import {
  browserRecipients,
  workflowDocuments,
  workflowMessages,
  workflowNotifications,
  workflowRuns,
  workflows,
  projectEnabledWorkflows,
  and,
  eq,
  sql,
  type Database,
} from "@factory/db";
import type {
  WorkflowStorePort,
  PushSubscription,
  BrowserRecipient,
  WorkflowNotificationRecord,
} from "../domain/WorkflowStorePort";
import type { ProjectRegistryPort } from "../../project-workspace/domain/ProjectWorkspacePort";

export class DrizzleWorkflowStoreAdapter implements WorkflowStorePort {
  constructor(
    private readonly database: Database,
    private readonly projects: ProjectRegistryPort,
    private readonly vapidPublicKey: string | null = null,
    private readonly capabilities: (
      daemonId: string,
    ) => HarnessCapability[] = () => [],
  ) {}
  async saveDefinition(
    definition: WorkflowDefinition,
  ): Promise<WorkflowDefinition> {
    await this.database
      .insert(workflows)
      .values({ workflowId: definition.workflowId, definition })
      .onConflictDoUpdate({
        target: workflows.workflowId,
        set: { definition },
      });
    return structuredClone(definition);
  }
  async deleteDefinition(workflowId: string): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ workflowId: workflows.workflowId })
        .from(workflows)
        .where(eq(workflows.workflowId, workflowId))
        .limit(1);
      if (!existing) return false;
      await transaction
        .delete(projectEnabledWorkflows)
        .where(eq(projectEnabledWorkflows.workflowId, workflowId));
      await transaction
        .delete(workflows)
        .where(eq(workflows.workflowId, workflowId));
      return true;
    });
  }
  async findDefinition(id: string): Promise<WorkflowDefinition | null> {
    const [row] = await this.database
      .select()
      .from(workflows)
      .where(eq(workflows.workflowId, id))
      .limit(1);
    return row ? (structuredClone(row.definition) as WorkflowDefinition) : null;
  }
  async listDefinitions(): Promise<WorkflowDefinition[]> {
    return (await this.database.select().from(workflows)).map(
      (row) => structuredClone(row.definition) as WorkflowDefinition,
    );
  }
  async findCapabilities(id: string) {
    return this.capabilities(id);
  }
  async listNotifications(
    runId: string,
  ): Promise<WorkflowNotificationRecord[]> {
    return (
      await this.database
        .select()
        .from(workflowNotifications)
        .where(eq(workflowNotifications.runId, runId))
    ).map((row) => ({
      ...(row.payload as WorkflowNotification),
      deliveryStatus: row.deliveryStatus,
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    }));
  }
  async findProject(id: string) {
    return this.projects.findProject(id);
  }
  async createRun(run: WorkflowRun): Promise<WorkflowRun> {
    await this.database.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(workflowRuns)
        .values({
          runId: run.runId,
          projectId: run.projectId,
          workflowId: run.workflowId,
          daemonId: run.daemonId,
          recipientId: run.recipientId,
          snapshot: run.snapshot,
          state: run,
          createdAt: new Date(run.createdAt),
        })
        .onConflictDoNothing()
        .returning({ runId: workflowRuns.runId });
      if (!inserted.length) return;
      await transaction.execute(
        sql`select dbos.enqueue_workflow(workflow_name => 'interpretWorkflowRun', queue_name => 'workflow-runs', positional_args => ARRAY[${JSON.stringify(run.runId)}::json], workflow_id => ${run.runId}, app_version => 'workflow-v1', application_name => 'factory-coordinator')`,
      );
    });
    return (await this.findRun(run.runId))!;
  }
  async findRun(id: string): Promise<WorkflowRun | null> {
    const [row] = await this.database
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.runId, id))
      .limit(1);
    return row ? (structuredClone(row.state) as WorkflowRun) : null;
  }
  async listRuns(projectId?: string): Promise<WorkflowRun[]> {
    const query = this.database.select().from(workflowRuns);
    const rows = projectId
      ? await query.where(eq(workflowRuns.projectId, projectId))
      : await query;
    return rows.map((row) => structuredClone(row.state) as WorkflowRun);
  }
  async submitMessage(
    runId: string,
    messageId: string,
    message: WorkflowMessage,
  ): Promise<"accepted" | "duplicate" | "conflict"> {
    return this.database.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(workflowMessages)
        .values({ messageId, runId, payload: message })
        .onConflictDoNothing()
        .returning({ messageId: workflowMessages.messageId });
      if (!inserted.length) {
        const matches = await transaction
          .select({ messageId: workflowMessages.messageId })
          .from(workflowMessages)
          .where(
            and(
              eq(workflowMessages.messageId, messageId),
              eq(workflowMessages.runId, runId),
              eq(workflowMessages.payload, message),
            ),
          );
        return matches.length ? "duplicate" : "conflict";
      }
      await transaction.execute(
        sql`select dbos.send_message(${runId},${JSON.stringify(message)}::json,'commands',${messageId})`,
      );
      return "accepted";
    });
  }
  async findDocument(revisionId: string): Promise<DocumentRevision | null> {
    const [row] = await this.database
      .select()
      .from(workflowDocuments)
      .where(eq(workflowDocuments.revisionId, revisionId))
      .limit(1);
    return row
      ? {
          revisionId: row.revisionId,
          runId: row.runId,
          documentId: row.documentId,
          name: row.name,
          revision: row.revision,
          executionId: row.executionId,
          activityId: row.activityId,
          content: row.content,
          consumedRevisionIds: row.consumedRevisions as string[],
          createdAt: row.createdAt.toISOString(),
        }
      : null;
  }
  async createRecipient(): Promise<
    BrowserRecipient & { managementToken: string }
  > {
    const recipientId = randomBytes(24).toString("base64url");
    const managementToken = randomBytes(32).toString("base64url");
    await this.database
      .insert(browserRecipients)
      .values({ recipientId, managementTokenHash: hashToken(managementToken) });
    return {
      recipientId,
      managementToken,
      active: true,
      deliveryStatus: "unenrolled",
      vapidPublicKey: this.vapidPublicKey,
    };
  }
  async authorizeRecipient(id: string, token: string): Promise<boolean> {
    const [row] = await this.database
      .select({ hash: browserRecipients.managementTokenHash })
      .from(browserRecipients)
      .where(eq(browserRecipients.recipientId, id))
      .limit(1);
    if (!row) return false;
    const actual = Buffer.from(hashToken(token), "hex");
    const expected = Buffer.from(row.hash, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
  async findRecipient(id: string): Promise<BrowserRecipient | null> {
    const [row] = await this.database
      .select()
      .from(browserRecipients)
      .where(eq(browserRecipients.recipientId, id))
      .limit(1);
    return row
      ? {
          recipientId: row.recipientId,
          active: row.active,
          deliveryStatus: row.deliveryStatus,
          lastDeliveryError: row.lastDeliveryError ?? null,
          vapidPublicKey: this.vapidPublicKey,
        }
      : null;
  }
  async replaceSubscription(
    id: string,
    subscription: PushSubscription | null,
  ): Promise<BrowserRecipient> {
    await this.database
      .update(browserRecipients)
      .set({
        subscription,
        active: subscription !== null,
        deliveryStatus: subscription ? "enrolled" : "unenrolled",
        lastDeliveryError: null,
      })
      .where(eq(browserRecipients.recipientId, id));
    return (await this.findRecipient(id))!;
  }
}
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
