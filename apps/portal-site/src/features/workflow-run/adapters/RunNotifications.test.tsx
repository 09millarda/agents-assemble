import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { RunNotifications } from "./RunNotifications";
test("notification view distinguishes push acceptance from failure without changing the completed result", () => {
  const html = renderToString(
    <RunNotifications
      notifications={[
        {
          notificationId: "notice-1",
          runId: "run-1",
          recipientId: "browser-1",
          kind: "result",
          title: "Workflow completed",
          body: "Pull request created",
          url: "/projects/project-1/runs/run-1",
          deliveryStatus: "failed",
          attempts: 2,
          lastError: "Push service rejected delivery",
          createdAt: "2026-09-15T12:00:00.000Z",
        },
      ]}
    />,
  );
  for (const expected of [
    "Workflow completed",
    "failed",
    "Push service rejected delivery",
    "notice-1",
    "2",
  ])
    expect(html).toContain(expected);
  expect(html).toContain(
    "Acceptance by a push service does not confirm browser display",
  );
});
