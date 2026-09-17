import webPush from "web-push";
import { createHash } from "node:crypto";
import type { WorkflowNotification } from "@factory/workflow";
import {
  PushDeliveryError,
  type PushDeliveryPort,
  type PushSubscription,
} from "../domain/PushDeliveryPort";
export interface VapidSettings {
  subject: string;
  publicKey: string;
  privateKey: string;
}
export class NodeWebPushAdapter implements PushDeliveryPort {
  constructor(
    private readonly vapid: VapidSettings,
    private readonly sendNotification: typeof webPush.sendNotification = webPush.sendNotification,
  ) {}
  async send(
    notification: WorkflowNotification,
    subscription: PushSubscription,
  ): Promise<void> {
    try {
      await this.sendNotification(
        subscription,
        JSON.stringify({
          ...notification,
          title: notification.title.slice(0, 80),
          body: notification.body.slice(0, 280),
        }),
        {
          vapidDetails: this.vapid,
          TTL: 86400,
          topic: createHash("sha256")
            .update(notification.notificationId)
            .digest("base64url")
            .slice(0, 32),
          timeout: 15000,
        },
      );
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "statusCode" in error
          ? error.statusCode
          : null;
      throw new PushDeliveryError(
        error instanceof Error
          ? error.message
          : "Web Push rejected the notification",
        status === 404 || status === 410,
      );
    }
  }
}
