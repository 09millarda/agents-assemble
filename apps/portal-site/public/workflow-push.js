// src/features/browser-recipient/adapters/workflowPushWorker.ts
var workflowWorker = self;
function isSafeRelativeUrl(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}
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
      notificationId: notification.notificationId,
      ...isSafeRelativeUrl(notification.url) ? { url: notification.url } : {}
    }
  }));
});
workflowWorker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const safeUrl = typeof data === "object" && data !== null && "url" in data ? data.url : undefined;
  if (isSafeRelativeUrl(safeUrl)) {
    const target = new URL(safeUrl, workflowWorker.location.origin).href;
    event.waitUntil(workflowWorker.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((window) => window.url === target);
      if (existing)
        return existing.focus();
      return workflowWorker.clients.openWindow(target);
    }));
    return;
  }
  const target = new URL("/", workflowWorker.location.origin).href;
  event.waitUntil(workflowWorker.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const existing = windows.find((window) => window.url === target);
    if (existing)
      return existing.focus();
    return workflowWorker.clients.openWindow(target);
  }));
});
