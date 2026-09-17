import {
  PushDeliveryError,
  type NotificationDeliveryStorePort,
  type PushDeliveryPort,
  type PendingPush,
} from "../domain/PushDeliveryPort";
export async function deliverNotifications(
  store: NotificationDeliveryStorePort,
  push: PushDeliveryPort,
): Promise<void> {
  for (const pending of await store.pendingNotifications()) {
    if (!canDeliverNotification(pending)) {
      await store.updateNotificationDelivery(
        pending.notification.notificationId,
        "failed",
        "Browser is not enrolled or its subscription is inactive.",
      );
      continue;
    }
    try {
      await push.send(pending.notification, pending.subscription!);
      await store.updateNotificationDelivery(
        pending.notification.notificationId,
        "accepted",
        undefined,
        pending.subscription!.endpoint,
      );
    } catch (error) {
      const expired = isSubscriptionExpired(error);
      await store.updateNotificationDelivery(
        pending.notification.notificationId,
        expired ? "expired" : "failed",
        error instanceof Error ? error.message : "Push delivery failed",
        pending.subscription!.endpoint,
      );
      if (expired && pending.notification.recipientId)
        await store.deactivateRecipient(
          pending.notification.recipientId,
          pending.subscription!.endpoint,
        );
    }
  }
}
function canDeliverNotification(pending: PendingPush): boolean {
  return pending.active && pending.subscription !== null;
}
function isSubscriptionExpired(error: unknown): boolean {
  return error instanceof PushDeliveryError && error.expired;
}
