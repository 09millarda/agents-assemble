// src/features/browser-recipient/adapters/workflowPushWorker.ts
var workflowWorker = self;
workflowWorker.addEventListener("push", (event) => {
  let notification;
  try {
    notification = event.data?.json() ?? null;
  } catch {
    return;
  }
  if (!notification || typeof notification.runId !== "string" || typeof notification.notificationId !== "string")
    return;
  event.waitUntil(workflowWorker.registration.showNotification(notification.title || "Workflow update", {
    body: notification.body || "",
    tag: notification.notificationId,
    data: {
      runId: notification.runId,
      notificationId: notification.notificationId
    }
  }));
});
workflowWorker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const runId = event.notification.data?.runId;
  if (typeof runId !== "string")
    return;
  const target = new URL(`/workflow-runs/${encodeURIComponent(runId)}`, workflowWorker.location.origin).href;
  event.waitUntil(workflowWorker.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const existing = windows.find((window) => window.url === target);
    if (existing)
      return existing.focus();
    return workflowWorker.clients.openWindow(target);
  }));
});
