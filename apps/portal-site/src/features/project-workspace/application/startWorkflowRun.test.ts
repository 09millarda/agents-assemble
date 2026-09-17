import { expect, test } from "bun:test";
import type { WorkflowRun } from "@factory/workflow";
import type { BrowserNotificationPort } from "../../browser-recipient/domain/BrowserNotificationPort";
import type { BrowserRecipientPort } from "../../browser-recipient/domain/BrowserRecipientPort";
import type { WorkflowRunPort } from "../../workflow-run/domain/WorkflowRunPort";
import { startWorkflowRun } from "./startWorkflowRun";

const createdRun: WorkflowRun = {
  runId: "run-1",
  name: "Build feature",
  projectId: "project-1",
  workflowId: "workflow-1",
  daemonId: "daemon-1",
  recipientId: "recipient-1",
  snapshot: { workflowId: "workflow-1", name: "Build feature", description: "", status: "published", tags: [], activities: [], positions: {} },
  workspace: { projectPath: "/home/example/portal" },
  workspaceResult: null,
  kickoffPrompt: "Build the page",
  status: "queued",
  executions: [],
  documents: [],
  interaction: null,
  loopPasses: {},
  loopLimits: {},
  processedMessageIds: [],
  approvedTreeHash: null,
  acceptedFindings: false,
  acceptedFindingRevisionIds: [],
  publication: null,
  error: null,
  createdAt: "2026-09-16T12:00:00.000Z",
  updatedAt: "2026-09-16T12:00:00.000Z",
};

const browser: BrowserNotificationPort = {
  requestPermission: async () => "granted",
  loadCredential: () => ({ recipientId: "recipient-1", managementToken: "management-token" }),
  saveCredential: () => {},
  subscribe: async () => ({ endpoint: "https://push.example", keys: { auth: "auth", p256dh: "p256dh" } }),
};

const recipients: BrowserRecipientPort = {
  createRecipient: async () => ({ recipientId: "recipient-1", managementToken: "management-token", active: true, deliveryStatus: "ready", vapidPublicKey: null }),
  getStatus: async () => ({ recipientId: "recipient-1", active: true, deliveryStatus: "ready", vapidPublicKey: null }),
  replaceSubscription: async () => ({ recipientId: "recipient-1", active: true, deliveryStatus: "ready", vapidPublicKey: null }),
};

function createRuns(overrides: Partial<WorkflowRunPort> = {}): WorkflowRunPort {
  return {
    startRun: async () => createdRun,
    listRuns: async () => [],
    getRun: async () => createdRun,
    listNotifications: async () => [],
    submitCommand: async () => {},
    deleteRun: async () => {},
    ...overrides,
  };
}

test("starting a workflow passes trimmed context and opens the created run", async () => {
  const received: unknown[] = [];
  const opened: string[] = [];
  const runs = createRuns({
    startRun: async (input) => {
      received.push(input);
      return createdRun;
    },
  });

  await startWorkflowRun({
    runs,
    browser,
    recipients,
    navigation: {
      openRun: async (runId, projectId) => {
        opened.push([runId, projectId].join("/"));
      },
    },
    resolveRequestId: () => "request-1",
    projectId: "project-1",
    workflowId: "workflow-1",
    kickoffPrompt: "  Build the page  ",
    branch: "  main  ",
    notifyBrowser: true,
  });

  expect(received).toEqual([
    {
      projectId: "project-1",
      workflowId: "workflow-1",
      kickoffPrompt: "Build the page",
      branch: "main",
      recipientId: "recipient-1",
      managementToken: "management-token",
      requestId: "request-1",
    },
  ]);
  expect(opened).toEqual(["run-1/project-1"]);
});

test("starting a workflow leaves navigation untouched when creation fails", async () => {
  const opened: string[] = [];

  await expect(
    startWorkflowRun({
      runs: createRuns({ startRun: async () => { throw new Error("Factory API is down."); } }),
      browser,
      recipients,
      navigation: {
        openRun: async (runId) => {
          opened.push(runId);
        },
      },
      resolveRequestId: () => "request-1",
      projectId: "project-1",
      workflowId: "workflow-1",
      kickoffPrompt: "",
      branch: "",
      notifyBrowser: false,
    }),
  ).rejects.toThrow("Factory API is down.");

  expect(opened).toEqual([]);
});
