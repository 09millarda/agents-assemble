import { expect, test } from "bun:test";
import { NodeWebPushAdapter } from "./NodeWebPushAdapter";
test("push retries reuse notification identity with stable configured VAPID keys", async () => {
  const deliveries: Array<{ payload: string; options: unknown }> = [];
  const adapter = new NodeWebPushAdapter(
    {
      subject: "mailto:operator@example.test",
      publicKey: "public",
      privateKey: "private",
    },
    async (_subscription, payload, options) => {
      deliveries.push({ payload: String(payload), options });
      return { statusCode: 201, headers: {}, body: "" };
    },
  );
  const notification = {
    notificationId: "run:result",
    runId: "run",
    recipientId: "browser",
    kind: "result" as const,
    title: "Done",
    body: "Ready",
    url: "/projects/project/runs/run",
  };
  const subscription = {
    endpoint: "https://push.example/id",
    keys: { auth: "auth", p256dh: "key" },
  };
  await adapter.send(notification, subscription);
  await adapter.send(notification, subscription);
  expect(JSON.parse(deliveries[0].payload).notificationId).toBe("run:result");
  expect(deliveries[0]).toEqual(deliveries[1]);
  expect(deliveries[0].options).toMatchObject({
    vapidDetails: {
      subject: "mailto:operator@example.test",
      publicKey: "public",
      privateKey: "private",
    },
  });
});
test("large questions are delivered as bounded previews with the original run identity", async () => {
  let body = "";
  const adapter = new NodeWebPushAdapter(
    {
      subject: "mailto:operator@example.test",
      publicKey: "public",
      privateKey: "private",
    },
    async (_subscription, payload) => {
      body = String(payload);
      return { statusCode: 201, headers: {}, body: "" };
    },
  );
  await adapter.send(
    {
      notificationId: "large-question",
      runId: "run",
      recipientId: "browser",
      kind: "question",
      title: "Run",
      body: "Question ".repeat(2000),
      url: "/projects/project/runs/run",
    },
    {
      endpoint: "https://push.example/id",
      keys: { auth: "auth", p256dh: "key" },
    },
  );
  expect(new TextEncoder().encode(body).length).toBeLessThan(3000);
  expect(JSON.parse(body).runId).toBe("run");
});
