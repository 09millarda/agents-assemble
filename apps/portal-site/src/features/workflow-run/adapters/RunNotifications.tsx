import type { RunNotification } from "../domain/WorkflowRunPort";

export function RunNotifications({
  notifications,
}: {
  notifications: RunNotification[];
}) {
  return (
    <section
      className="grid gap-3 rounded-lg border bg-white p-4"
      aria-label="Run notifications"
    >
      <h2 className="font-semibold">Notifications</h2>
      <p className="text-xs text-slate-500">
        Acceptance by a push service does not confirm browser display. Delivery
        failures leave completed work and published pull requests intact.
      </p>
      {notifications.length === 0 ? (
        <p className="text-sm text-slate-500">No notifications recorded yet.</p>
      ) : (
        <ul className="grid gap-2">
          {notifications.map((notification) => (
            <li
              key={notification.notificationId}
              className="grid gap-1 rounded-md border p-3"
            >
              <p className="text-sm font-medium">{notification.title}</p>
              <p className="text-sm">{notification.body}</p>
              <p className="text-xs text-slate-500">
                {notification.deliveryStatus} · {notification.attempts}{" "}
                attempt(s) ·{" "}
                <span className="font-mono">{notification.notificationId}</span>
              </p>
              {notification.lastError ? (
                <p className="text-xs text-red-700">{notification.lastError}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
