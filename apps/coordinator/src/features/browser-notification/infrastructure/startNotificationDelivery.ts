import type { NotificationDeliveryStorePort } from "../domain/PushDeliveryPort";
import { deliverNotifications } from "../application/deliverNotifications";
import { NodeWebPushAdapter } from "../adapters/NodeWebPushAdapter";
export function startNotificationDelivery(
  store: NotificationDeliveryStorePort,
): () => void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    console.info(
      "Browser push is unavailable: configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.",
    );
    return () => {};
  }
  const adapter = new NodeWebPushAdapter({ publicKey, privateKey, subject });
  let running = false;
  const deliver = async () => {
    if (running) return;
    running = true;
    try {
      await deliverNotifications(store, adapter);
    } catch (error) {
      console.error("Notification delivery failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void deliver(), 10000);
  void deliver();
  return () => clearInterval(timer);
}
