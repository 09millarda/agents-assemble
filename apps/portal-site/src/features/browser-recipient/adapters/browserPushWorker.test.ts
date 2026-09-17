import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

async function loadWorker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const notifications: unknown[] = [];
  const opened: string[] = [];
  const pending: Promise<unknown>[] = [];
  const source = await readFile(
    new URL("./workflowPushWorker.ts", import.meta.url),
    "utf8",
  );
  runInNewContext(new Bun.Transpiler({ loader: "ts" }).transformSync(source), {
    self: {
      location: { origin: "https://portal.example" },
      addEventListener: (name: string, handler: (event: unknown) => void) => {
        handlers[name] = handler;
      },
      registration: {
        showNotification: async (title: string, options: unknown) => {
          notifications.push({ title, options });
        },
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (url: string) => {
          opened.push(url);
        },
      },
    },
    URL,
    encodeURIComponent,
  });
  return { handlers, notifications, opened, pending };
}

test("closed-page push ignores attacker urls and falls back to the portal root", async () => {
  const { handlers, notifications, opened, pending } = await loadWorker();
  handlers.push!({
    data: {
      json: () => ({
        notificationId: "notification-1",
        runId: "run-1",
        title: "Approval needed",
        body: "Review output",
        url: "https://attacker.example",
      }),
    },
    waitUntil: (work: Promise<unknown>) => pending.push(work),
  });
  await Promise.all(pending);
  expect(notifications).toEqual([
    {
      title: "Approval needed",
      options: {
        body: "Review output",
        tag: "notification-1",
        data: { runId: "run-1", notificationId: "notification-1" },
      },
    },
  ]);
  handlers.notificationclick!({
    notification: { data: { runId: "run-1" }, close() {} },
    waitUntil: (work: Promise<unknown>) => pending.push(work),
  });
  await Promise.all(pending);
  expect(opened).toEqual(["https://portal.example/"]);
});

test("a project-nested notification url opens the nested run page", async () => {
  const { handlers, notifications, opened, pending } = await loadWorker();
  handlers.push!({
    data: {
      json: () => ({
        notificationId: "notification-2",
        runId: "run-1",
        title: "Approval needed",
        body: "Review output",
        url: "/projects/project-1/runs/run-1",
      }),
    },
    waitUntil: (work: Promise<unknown>) => pending.push(work),
  });
  await Promise.all(pending);
  expect(notifications).toEqual([
    {
      title: "Approval needed",
      options: {
        body: "Review output",
        tag: "notification-2",
        data: {
          runId: "run-1",
          notificationId: "notification-2",
          url: "/projects/project-1/runs/run-1",
        },
      },
    },
  ]);
  handlers.notificationclick!({
    notification: {
      data: { runId: "run-1", url: "/projects/project-1/runs/run-1" },
      close() {},
    },
    waitUntil: (work: Promise<unknown>) => pending.push(work),
  });
  await Promise.all(pending);
  expect(opened).toEqual(["https://portal.example/projects/project-1/runs/run-1"]);
});
