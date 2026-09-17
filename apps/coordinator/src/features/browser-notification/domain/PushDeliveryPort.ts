import type { WorkflowNotification } from "@factory/workflow";
export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PendingPush {
  notification: WorkflowNotification;
  subscription: PushSubscription | null;
  active: boolean;
  attempts: number;
}
export interface PushDeliveryPort {
  send(
    notification: WorkflowNotification,
    subscription: PushSubscription,
  ): Promise<void>;
}
export interface NotificationDeliveryStorePort {
  pendingNotifications(): Promise<PendingPush[]>;
  updateNotificationDelivery(
    notificationId: string,
    status: "accepted" | "failed" | "expired",
    error?: string,
    expectedEndpoint?: string,
  ): Promise<void>;
  deactivateRecipient(
    recipientId: string,
    expectedEndpoint: string,
  ): Promise<void>;
}
export class PushDeliveryError extends Error {
  constructor(
    message: string,
    readonly expired: boolean,
  ) {
    super(message);
  }
}
