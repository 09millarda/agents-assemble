import { afterEach, expect, test } from "bun:test";
import { HttpWorkflowRunAdapter } from "./HttpWorkflowRunAdapter";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("manual starts omit absent prompts and bind only the initiating browser credential", async () => {
  let request: unknown;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body)),
      };
      return Response.json({ runId: "run-1", status: "queued" });
    },
    { preconnect: originalFetch.preconnect },
  );
  await new HttpWorkflowRunAdapter("https://factory.example").startRun({
    workflowId: "build",
    projectId: "project",
    requestId: "start-1",
    recipientId: "browser-1",
    managementToken: "browser-secret",
  });
  expect(request).toEqual({
    url: "https://factory.example/v1/workflow-runs",
    method: "POST",
    body: {
      workflowId: "build",
      projectId: "project",
      requestId: "start-1",
      recipientId: "browser-1",
      managementToken: "browser-secret",
    },
  });
});

test("human commands preserve interaction and idempotency identities; server conflicts remain visible", async () => {
  let body: unknown;
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return Response.json(
        { detail: "This approval was already answered." },
        { status: 409 },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const adapter = new HttpWorkflowRunAdapter("https://factory.example");
  await expect(
    adapter.submitCommand({
      runId: "run-1",
      interactionId: "approval-1",
      messageId: "answer-1",
      action: "approve",
    }),
  ).rejects.toThrow("This approval was already answered.");
  expect(body).toEqual({
    interactionId: "approval-1",
    messageId: "answer-1",
    action: "approve",
  });
});

test("run notifications expose persisted delivery attempts independently of run completion", async () => {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://factory.example/v1/workflow-runs/run-1/notifications?limit=100",
      );
      return Response.json({
        data: [
          {
            notificationId: "notice-1",
            runId: "run-1",
            recipientId: "browser-1",
            kind: "result",
            title: "Completed",
            body: "Pull request created",
            url: "/projects/project-1/runs/run-1",
            deliveryStatus: "failed",
            attempts: 2,
            lastError: "Push service unavailable",
            createdAt: "2026-09-15T12:00:00.000Z",
          },
        ],
        pagination: { nextCursor: null, limit: 100 },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const notifications = await new HttpWorkflowRunAdapter(
    "https://factory.example",
  ).listNotifications("run-1");
  expect(notifications[0]?.lastError).toBe("Push service unavailable");
  expect(notifications[0]?.attempts).toBe(2);
});

test("deleting a run issues a hard delete for the terminal run", async () => {
  let request: unknown;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), method: init?.method };
      return Response.json({ deleted: true });
    },
    { preconnect: originalFetch.preconnect },
  );
  await new HttpWorkflowRunAdapter("https://factory.example").deleteRun("run-1");
  expect(request).toEqual({
    url: "https://factory.example/v1/workflow-runs/run-1",
    method: "DELETE",
  });
});
