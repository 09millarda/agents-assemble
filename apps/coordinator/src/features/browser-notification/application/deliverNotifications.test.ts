import { expect, test } from "bun:test";
import { deliverNotifications } from "./deliverNotifications";
import {
  PushDeliveryError,
  type PendingPush,
} from "../domain/PushDeliveryPort";
test("expired subscriptions deactivate their browser and push failures stay independent of completed work", async () => {
  const pending: PendingPush[] = [
    {
      notification: {
        notificationId: "run:result",
        runId: "run",
        recipientId: "browser",
        kind: "result",
        title: "Done",
        body: "PR published",
        url: "/projects/project/runs/run",
      },
      subscription: {
        endpoint: "https://push.example/subscription",
        keys: { auth: "auth", p256dh: "key" },
      },
      active: true,
      attempts: 0,
    },
  ];
  const records: { notificationId: string; status: string }[] = [];
  const deactivated: string[] = [];
  await deliverNotifications(
    {
      pendingNotifications: async () => pending,
      updateNotificationDelivery: async (notificationId, status) => {
        records.push({ notificationId, status });
      },
      deactivateRecipient: async (recipientId) => {
        deactivated.push(recipientId);
      },
    },
    {
      send: async () => {
        throw new PushDeliveryError("Subscription expired", true);
      },
    },
  );
  expect(records).toEqual([
    { notificationId: "run:result", status: "expired" },
  ]);
  expect(deactivated).toEqual(["browser"]);
});
