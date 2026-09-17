import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  createDatabaseConnection,
  DrizzleWorkflowRuntimeAdapter,
  projects,
  daemons,
} from "@factory/db";
import { createWorkflowRun } from "@factory/workflow";
import { DrizzleProjectRegistryAdapter } from "../../project-workspace/adapters/DrizzleProjectRegistryAdapter";
import { DrizzleWorkflowStoreAdapter } from "./DrizzleWorkflowStoreAdapter";
import { buildWorkflowTestApp } from "../../../routes/testing/buildWorkflowTestApp";
const databaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL;
test.skipIf(!databaseUrl)(
  "persisted delivery rejection is visible to the enrolled browser without changing run completion",
  async () => {
    const database = createDatabaseConnection(databaseUrl!);
    const id = randomUUID();
    await database
      .insert(projects)
      .values({
        projectId: id,
        name: "Notification test",
        absolutePath: "/tmp/notification-test",
      });
    await database
      .insert(daemons)
      .values({
        daemonId: id,
        machineName: "Notification test",
        authTokenHash: "test-hash",
      });
    const store = new DrizzleWorkflowStoreAdapter(
      database,
      new DrizzleProjectRegistryAdapter(database),
    );
    const app = buildWorkflowTestApp(store);
    const browser = await store.createRecipient();
    await store.replaceSubscription(browser.recipientId, {
      endpoint: "https://push.example/rejection",
      keys: { auth: "auth", p256dh: "key" },
    });
    const now = new Date().toISOString();
    const run = createWorkflowRun(
      {
        runId: id,
        projectId: id,
        daemonId: id,
        recipientId: browser.recipientId,
        workflow: {
          workflowId: "notification-test",
          name: "Notification test",
          description: "",
          activities: [],
          positions: {},
        },
        workspace: { projectPath: "/tmp/notification-test" },
      },
      now,
    );
    run.status = "completed";
    const runtime = new DrizzleWorkflowRuntimeAdapter(database);
    await runtime.saveTransition({
      run,
      commands: [],
      notifications: [
        {
          notificationId: id,
          runId: id,
          recipientId: browser.recipientId,
          kind: "result",
          title: "Finished",
          body: "Run finished",
          url: "/runs/" + id,
        },
      ],
    });
    await runtime.updateNotificationDelivery(
      id,
      "failed",
      "Push service rejected delivery.",
      "https://push.example/rejection",
    );
    const response = await app.request(
      "/v1/browser-recipients/" + browser.recipientId,
      { headers: { authorization: "Bearer " + browser.managementToken } },
    );
    expect(response.status).toBe(200);
    const status = await response.json();
    expect(status.deliveryStatus).toBe("failed");
    expect(status.lastDeliveryError).toBe("Push service rejected delivery.");
    expect((await runtime.findRun(id))?.status).toBe("completed");
    const notifications = await (
      await app.request("/v1/workflow-runs/" + id + "/notifications")
    ).json();
    expect(notifications.data[0].notificationId).toBe(id);
    expect(notifications.data[0].attempts).toBe(1);
  },
);

test.skipIf(!databaseUrl)(
  "an expired old subscription cannot deactivate its replacement",
  async () => {
    const database = createDatabaseConnection(databaseUrl!);
    const id = randomUUID();
    await database
      .insert(projects)
      .values({
        projectId: id,
        name: "Subscription race",
        absolutePath: "/tmp/subscription-race",
      });
    await database
      .insert(daemons)
      .values({
        daemonId: id,
        machineName: "Subscription race",
        authTokenHash: "test-hash",
      });
    const store = new DrizzleWorkflowStoreAdapter(
      database,
      new DrizzleProjectRegistryAdapter(database),
    );
    const browser = await store.createRecipient();
    const original = {
      endpoint: "https://push.example/old",
      keys: { auth: "auth", p256dh: "key" },
    };
    const replacement = { ...original, endpoint: "https://push.example/new" };
    await store.replaceSubscription(browser.recipientId, original);
    const run = createWorkflowRun(
      {
        runId: id,
        projectId: id,
        daemonId: id,
        recipientId: browser.recipientId,
        workflow: {
          workflowId: "race",
          name: "Race",
          description: "",
          activities: [],
          positions: {},
        },
        workspace: { projectPath: "/tmp/subscription-race" },
      },
      new Date().toISOString(),
    );
    const runtime = new DrizzleWorkflowRuntimeAdapter(database);
    await runtime.saveTransition({
      run,
      commands: [],
      notifications: [
        {
          notificationId: id,
          runId: id,
          recipientId: browser.recipientId,
          kind: "result",
          title: "Done",
          body: "Done",
          url: "/runs/" + id,
        },
      ],
    });
    await store.replaceSubscription(browser.recipientId, replacement);
    await runtime.updateNotificationDelivery(
      id,
      "expired",
      "Old subscription expired.",
      original.endpoint,
    );
    await runtime.deactivateRecipient(browser.recipientId, original.endpoint);
    const status = await store.findRecipient(browser.recipientId);
    expect(status?.active).toBe(true);
    expect(status?.deliveryStatus).toBe("enrolled");
    expect(status?.lastDeliveryError).toBeNull();
  },
);
