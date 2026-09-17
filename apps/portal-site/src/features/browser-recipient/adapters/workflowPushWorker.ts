/// <reference lib="webworker" />

const workflowWorker = self as unknown as ServiceWorkerGlobalScope;

function isSafeRelativeUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  );
}

workflowWorker.addEventListener("push", (event: PushEvent) => {
  let notification: {
    notificationId?: unknown;
    runId?: unknown;
    title?: string;
    body?: string;
    url?: unknown;
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
          ...(isSafeRelativeUrl(notification.url) ? { url: notification.url } : {}),
        },
      },
    ),
  );
});

workflowWorker.addEventListener(
  "notificationclick",
  (event: NotificationEvent) => {
    event.notification.close();
    const data: unknown = event.notification.data;
    const safeUrl =
      typeof data === "object" && data !== null && "url" in data
        ? (data as { url?: unknown }).url
        : undefined;
    if (isSafeRelativeUrl(safeUrl)) {
      const target = new URL(safeUrl, workflowWorker.location.origin).href;
      event.waitUntil(
        workflowWorker.clients
          .matchAll({ type: "window", includeUncontrolled: true })
          .then(async (windows) => {
            const existing = windows.find((window) => window.url === target);
            if (existing) return existing.focus();
            return workflowWorker.clients.openWindow(target);
          }),
      );
      return;
    }
    const target = new URL("/", workflowWorker.location.origin).href;
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
