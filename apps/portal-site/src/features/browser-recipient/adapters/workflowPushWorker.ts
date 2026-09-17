/// <reference lib="webworker" />

const workflowWorker = self as unknown as ServiceWorkerGlobalScope;

workflowWorker.addEventListener("push", (event: PushEvent) => {
  let notification: {
    notificationId?: unknown;
    runId?: unknown;
    title?: string;
    body?: string;
  } | null;
  try {
    notification = event.data?.json() ?? null;
  } catch {
    return;
  }
  if (
    !notification ||
    typeof notification.runId !== "string" ||
    typeof notification.notificationId !== "string"
  )
    return;
  event.waitUntil(
    workflowWorker.registration.showNotification(
      notification.title || "Workflow update",
      {
        body: notification.body || "",
        tag: notification.notificationId,
        data: {
          runId: notification.runId,
          notificationId: notification.notificationId,
        },
      },
    ),
  );
});

workflowWorker.addEventListener(
  "notificationclick",
  (event: NotificationEvent) => {
    event.notification.close();
    const runId: unknown = event.notification.data?.runId;
    if (typeof runId !== "string") return;
    const target = new URL(
      `/workflow-runs/${encodeURIComponent(runId)}`,
      workflowWorker.location.origin,
    ).href;
    event.waitUntil(
      workflowWorker.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then(async (windows) => {
          const existing = windows.find((window) => window.url === target);
          if (existing) return existing.focus();
          return workflowWorker.clients.openWindow(target);
        }),
    );
  },
);
