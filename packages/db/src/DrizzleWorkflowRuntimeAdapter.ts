import type {
  WorkflowRun,
  WorkflowTransition,
  WorkflowNotification,
} from "@factory/workflow";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./connection";
import {
  browserRecipients,
  workflowCommands,
  workflowDocuments,
  workflowNotifications,
  workflowRuns,
} from "./schema";

export interface PushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}
export interface PendingNotification {
  notification: WorkflowNotification;
  subscription: PushSubscription | null;
  active: boolean;
  attempts: number;
}

export class DrizzleWorkflowRuntimeAdapter {
  constructor(private readonly database: Database) {}
  async findRun(runId: string): Promise<WorkflowRun | null> {
    const [row] = await this.database
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.runId, runId))
      .limit(1);
    return row ? (structuredClone(row.state) as WorkflowRun) : null;
  }
  async saveTransition(transition: WorkflowTransition): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const { run } = transition;
      await transaction
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
        .onConflictDoUpdate({
          target: workflowRuns.runId,
          set: { state: run, snapshot: run.snapshot },
        });
      for (const revision of run.documents) {
        await transaction
          .insert(workflowDocuments)
          .values({
            revisionId: revision.revisionId,
            runId: run.runId,
            documentId: revision.documentId,
            name: revision.name,
            executionId: revision.executionId,
            activityId: revision.activityId,
            revision: revision.revision,
            content: revision.content,
            consumedRevisions: revision.consumedRevisionIds,
            createdAt: new Date(revision.createdAt),
          })
          .onConflictDoNothing();
        const [stored] = await transaction
          .select()
          .from(workflowDocuments)
          .where(eq(workflowDocuments.revisionId, revision.revisionId));
        if (
          !stored ||
          stored.runId !== revision.runId ||
          stored.documentId !== revision.documentId ||
          stored.name !== revision.name ||
          stored.executionId !== revision.executionId ||
          stored.activityId !== revision.activityId ||
          stored.revision !== revision.revision ||
          stored.content !== revision.content ||
          JSON.stringify(stored.consumedRevisions) !==
            JSON.stringify(revision.consumedRevisionIds)
        ) {
          throw new Error(
            "A context document revision cannot change after publication.",
          );
        }
      }
      for (const command of transition.commands) {
        await transaction
          .insert(workflowCommands)
          .values({
            commandId: command.commandId,
            runId: run.runId,
            daemonId: command.daemonId,
            executionId: command.executionId,
            payload: command,
          })
          .onConflictDoNothing();
      }
      for (const notification of transition.notifications) {
        await transaction
          .insert(workflowNotifications)
          .values({
            notificationId: notification.notificationId,
            runId: run.runId,
            recipientId: notification.recipientId,
            payload: notification,
          })
          .onConflictDoNothing();
      }
    });
  }
  async pendingNotifications(): Promise<PendingNotification[]> {
    const rows = await this.database
      .select({
        payload: workflowNotifications.payload,
        subscription: browserRecipients.subscription,
        active: browserRecipients.active,
        attempts: workflowNotifications.attempts,
      })
      .from(workflowNotifications)
      .leftJoin(
        browserRecipients,
        eq(browserRecipients.recipientId, workflowNotifications.recipientId),
      )
      .where(
        and(
          inArray(workflowNotifications.deliveryStatus, ["pending", "failed"]),
          sql`${workflowNotifications.attempts} < 5`,
        ),
      );
    return rows.map((row) => ({
      notification: row.payload as WorkflowNotification,
      subscription: row.subscription as PushSubscription | null,
      active: row.active ?? false,
      attempts: row.attempts,
    }));
  }
  async updateNotificationDelivery(
    notificationId: string,
    status: "accepted" | "failed" | "expired",
    error?: string,
    expectedEndpoint?: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [notification] = await transaction
        .update(workflowNotifications)
        .set({
          deliveryStatus: status,
          lastError: error ?? null,
          attempts: sql`${workflowNotifications.attempts} + 1`,
        })
        .where(eq(workflowNotifications.notificationId, notificationId))
        .returning({ recipientId: workflowNotifications.recipientId });
      if (notification?.recipientId && expectedEndpoint)
        await transaction
          .update(browserRecipients)
          .set({ deliveryStatus: status, lastDeliveryError: error ?? null })
          .where(
            and(
              eq(browserRecipients.recipientId, notification.recipientId),
              sql`${browserRecipients.subscription}->>'endpoint' = ${expectedEndpoint}`,
            ),
          );
    });
  }
  async deactivateRecipient(
    recipientId: string,
    expectedEndpoint: string,
  ): Promise<void> {
    await this.database
      .update(browserRecipients)
      .set({ active: false, deliveryStatus: "expired" })
      .where(
        and(
          eq(browserRecipients.recipientId, recipientId),
          sql`${browserRecipients.subscription}->>'endpoint' = ${expectedEndpoint}`,
        ),
      );
  }
}
