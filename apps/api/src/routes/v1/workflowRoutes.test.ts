import { expect, test } from "bun:test";
import type { WorkflowDefinition } from "@factory/workflow";
import { buildWorkflowTestApp } from "../testing/buildWorkflowTestApp";
import { InMemoryWorkflowStore } from "../../features/workflow-management/adapters/testing/InMemoryWorkflowStore";

const definition: WorkflowDefinition = {
  workflowId: "build",
  name: "Build",
  description: "Build a feature from an agreed plan.",
  status: "published",
  tags: ["delivery", "planning"],
  positions: {},
  activities: [
    {
      activityId: "requirements",
      name: "Requirements",
      instructions: "Ask what to build",
      execution: {
        kind: "agent",
        harness: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
      },
      humanInput: "input",
      description: "",
      outcomes: [
        {
          name: "complete",
          handoff: { targetActivityId: null, continuation: "approval" },
        },
      ],
    },
  ],
};
test("starting without a prompt freezes the definition and only enqueues coordinator work", async () => {
  const store = new InMemoryWorkflowStore();
  store.definitions.set("build", definition);
  store.projects.set("project", {
    projectId: "project",
    name: "Project",
    absolutePath: "/tmp/project",
    daemonId: "daemon",
    gitStatus: "valid",
    blockedReason: null,
    enabledWorkflowIds: ["build"],
  });
  const app = buildWorkflowTestApp(store);
  const response = await app.request("/v1/workflow-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "run-request",
      workflowId: "build",
      projectId: "project",
    }),
  });
  expect(response.status).toBe(201);
  const run = await response.json();
  expect(run.status).toBe("queued");
  expect(run.kickoffPrompt).toBeNull();
  expect(run.executions).toEqual([]);
  definition.activities[0]!.instructions = "Changed later";
  expect(
    (await (await app.request("/v1/workflow-runs/" + run.runId)).json())
      .snapshot.activities[0].instructions,
  ).toBe("Ask what to build");
  expect(store.enqueuedRunIds).toEqual([run.runId]);
  const duplicate = await app.request("/v1/workflow-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "run-request",
      workflowId: "build",
      projectId: "project",
    }),
  });
  expect((await duplicate.json()).runId).toBe(run.runId);
  expect(store.enqueuedRunIds).toEqual([run.runId]);
});

test("browser management tokens protect subscription replacement and run binding", async () => {
  const store = new InMemoryWorkflowStore();
  const app = buildWorkflowTestApp(store);
  const created = await app.request("/v1/browser-recipients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(created.status).toBe(201);
  const browser = await created.json();
  const denied = await app.request(
    "/v1/browser-recipients/" + browser.recipientId + "/subscription",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        managementToken: "wrong-token",
        subscription: null,
      }),
    },
  );
  expect(denied.status).toBe(401);
  expect(denied.headers.get("content-type")).toContain(
    "application/problem+json",
  );
  const allowed = await app.request(
    "/v1/browser-recipients/" + browser.recipientId + "/subscription",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        managementToken: browser.managementToken,
        subscription: {
          endpoint: "https://push.example/subscription",
          keys: { auth: "auth", p256dh: "key" },
        },
      }),
    },
  );
  expect(allowed.status).toBe(200);
  expect((await allowed.json()).deliveryStatus).toBe("enrolled");
});

test("human responses enqueue typed commands and cannot mutate a run or publish documents", async () => {
  const store = new InMemoryWorkflowStore();
  const { createWorkflowRun } = await import("@factory/workflow");
  store.runs.set(
    "waiting",
    createWorkflowRun(
      {
        runId: "waiting",
        projectId: "project",
        daemonId: "daemon",
        workflow: definition,
        workspace: { projectPath: "/tmp/project" },
      },
      "2026-09-15T12:00:00.000Z",
    ),
  );
  const app = buildWorkflowTestApp(store);
  const request = () =>
    app.request("/v1/workflow-runs/waiting/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messageId: "answer-1",
        interactionId: "question-1",
        action: "answer",
        answer: "Build a tool",
      }),
    });
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(200);
  expect(store.messages.size).toBe(1);
  expect(store.runs.get("waiting")?.status).toBe("queued");
  expect(
    (
      await app.request("/v1/runs/waiting/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"outcome":"success"}',
      })
    ).status,
  ).toBe(404);
});

test("catalog resources are editable independent values with cursor pagination", async () => {
  const store = new InMemoryWorkflowStore();
  const app = buildWorkflowTestApp(store);
  const create = await app.request("/v1/workflows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...definition, tags: [" Delivery ", "delivery", "Planning"] }),
  });
  expect(create.status).toBe(201);
  expect(create.headers.get("location")).toBe("/v1/workflows/build");
  const workflow = await (await app.request("/v1/workflows/build")).json();
  expect(workflow.activities[0].name).toBe("Requirements");
  expect(workflow.description).toBe("Build a feature from an agreed plan.");
  expect(workflow.status).toBe("draft");
  expect(workflow.tags).toEqual(["delivery", "planning"]);
  const list = await (await app.request("/v1/workflows?limit=1")).json();
  expect(list.pagination).toEqual({ nextCursor: null, limit: 1 });
  expect(list.data[0].workflowId).toBe("build");
});

test("workflow catalog searches names and combines status and tag filters", async () => {
  const store = new InMemoryWorkflowStore();
  const draft = structuredClone(definition);
  draft.workflowId = "draft-build";
  draft.status = "draft";
  const secondPublished = structuredClone(definition);
  secondPublished.workflowId = "build-second";
  secondPublished.name = "Build second";
  store.definitions.set(definition.workflowId, definition);
  store.definitions.set(draft.workflowId, draft);
  store.definitions.set(secondPublished.workflowId, secondPublished);

  const response = await buildWorkflowTestApp(store).request(
    "/v1/workflows?search=build&status=published&tag=planning&tag=delivery&limit=1",
  );

  expect(response.status).toBe(200);
  expect((await response.json()).data.map((workflow: { workflowId: string }) => workflow.workflowId)).toEqual(["build"]);
  expect(response.headers.get("link")).toContain("search=build");
  expect(response.headers.get("link")).toContain("status=published");
  expect(response.headers.get("link")).toContain("tag=planning");
  expect(response.headers.get("link")).toContain("tag=delivery");
});

test("ordinary updates preserve a published status while normalizing tags", async () => {
  const store = new InMemoryWorkflowStore();
  store.definitions.set(definition.workflowId, definition);
  const response = await buildWorkflowTestApp(store).request(
    "/v1/workflows/build/update",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...definition, status: "draft", tags: [" Delivery ", "delivery", "Planning"] }),
    },
  );

  expect(response.status).toBe(200);
  expect((await response.json()).status).toBe("published");
  expect(store.definitions.get("build")?.tags).toEqual(["delivery", "planning"]);
});

test("publishing and unpublishing a workflow are idempotent lifecycle commands", async () => {
  const store = new InMemoryWorkflowStore();
  const draft = structuredClone(definition);
  draft.status = "draft";
  store.definitions.set(draft.workflowId, draft);
  store.projects.set("project", {
    projectId: "project",
    name: "Project",
    absolutePath: "/tmp/project",
    daemonId: "daemon",
    gitStatus: "valid",
    blockedReason: null,
    enabledWorkflowIds: [draft.workflowId],
  });
  const { createWorkflowRun } = await import("@factory/workflow");
  const activeRun = createWorkflowRun(
    {
      runId: "active-run",
      projectId: "project",
      daemonId: "daemon",
      workflow: definition,
      workspace: { projectPath: "/tmp/project" },
    },
    "2026-09-15T12:00:00.000Z",
  );
  store.runs.set(activeRun.runId, activeRun);
  const frozenSnapshot = structuredClone(activeRun.snapshot);
  const app = buildWorkflowTestApp(store);
  const publish = () =>
    app.request("/v1/workflows/build/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

  expect((await publish()).status).toBe(200);
  expect((await (await app.request("/v1/workflows/build")).json()).status).toBe("published");
  expect((await publish()).status).toBe(200);

  const unpublish = () =>
    app.request("/v1/workflows/build/unpublish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  expect((await unpublish()).status).toBe(200);
  expect((await (await app.request("/v1/workflows/build")).json()).status).toBe("draft");
  expect(store.projects.get("project")?.enabledWorkflowIds).toEqual([]);
  expect(store.runs.get("active-run")?.snapshot).toEqual(frozenSnapshot);
  expect((await unpublish()).status).toBe(200);
});

test("publishing rejects an invalid draft workflow", async () => {
  const store = new InMemoryWorkflowStore();
  const invalid = structuredClone(definition);
  invalid.status = "draft";
  invalid.activities[0]!.outcomes[0]!.handoff.targetActivityId = "missing";
  store.definitions.set(invalid.workflowId, invalid);

  const response = await buildWorkflowTestApp(store).request(
    "/v1/workflows/build/publish",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );

  expect(response.status).toBe(422);
  expect((await response.json()).code).toBe("INVALID_WORKFLOW");
  expect(store.definitions.get("build")?.status).toBe("draft");
});

test("deleting a workflow detaches projects and preserves existing runs", async () => {
  const store = new InMemoryWorkflowStore();
  store.definitions.set("build", definition);
  store.projects.set("project", {
    projectId: "project",
    name: "Project",
    absolutePath: "/tmp/project",
    daemonId: "daemon",
    gitStatus: "valid",
    blockedReason: null,
    enabledWorkflowIds: ["build", "ship"],
  });
  const { createWorkflowRun } = await import("@factory/workflow");
  store.runs.set(
    "existing-run",
    createWorkflowRun(
      {
        runId: "existing-run",
        projectId: "project",
        daemonId: "daemon",
        workflow: definition,
        workspace: { projectPath: "/tmp/project" },
      },
      "2026-09-15T12:00:00.000Z",
    ),
  );
  const app = buildWorkflowTestApp(store);

  const response = await app.request("/v1/workflows/build/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: true });
  expect(store.projects.get("project")?.enabledWorkflowIds).toEqual(["ship"]);
  expect((await app.request("/v1/workflows/build")).status).toBe(404);
  expect((await app.request("/v1/workflow-runs/existing-run")).status).toBe(200);
});

test("deleting an unknown workflow returns not found", async () => {
  const response = await buildWorkflowTestApp(new InMemoryWorkflowStore()).request(
    "/v1/workflows/missing/delete",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );

  expect(response.status).toBe(404);
  expect((await response.json()).code).toBe("WORKFLOW_NOT_FOUND");
});

test("reopening reads persisted conversations and exact document revisions", async () => {
  const store = new InMemoryWorkflowStore();
  const { createWorkflowRun } = await import("@factory/workflow");
  const run = createWorkflowRun(
    {
      runId: "restore",
      projectId: "project",
      daemonId: "daemon",
      workflow: definition,
      workspace: { projectPath: "/tmp/project" },
    },
    "2026-09-15T12:00:00.000Z",
  );
  run.interaction = {
    interactionId: "approval-1",
    executionId: "execution-1",
    kind: "approval",
    prompt: "Approve this plan",
    outputRevisionIds: ["revision-1"],
    targetActivityId: null,
  };
  run.documents = [
    {
      revisionId: "revision-1",
      runId: "restore",
      documentId: "plan",
      name: "Plan",
      revision: 1,
      executionId: "execution-1",
      activityId: "requirements",
      content: "# Plan\nExact content",
      consumedRevisionIds: [],
      createdAt: "2026-09-15T12:00:00.000Z",
    },
  ];
  store.runs.set(run.runId, run);
  const app = buildWorkflowTestApp(store);
  const docs = await (
    await app.request("/v1/workflow-runs/restore/documents")
  ).json();
  expect(docs.data[0].content).toBe("# Plan\nExact content");
  const interactions = await (
    await app.request("/v1/workflow-runs/restore/human-interactions")
  ).json();
  expect(interactions.data[0].outputRevisionIds).toEqual(["revision-1"]);
  expect(
    (await (await app.request("/v1/documents/revision-1")).json()).executionId,
  ).toBe("execution-1");
});

test("workflow validation allows cycles but rejects unknown handoff targets", async () => {
  const store = new InMemoryWorkflowStore();
  const app = buildWorkflowTestApp(store);
  const invalid = structuredClone(definition);
  invalid.activities[0]!.outcomes[0]!.handoff.targetActivityId = "missing";
  const response = await app.request("/v1/workflows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(invalid),
  });
  expect(response.status).toBe(422);
  expect(store.definitions.size).toBe(0);
});

test("unsupported model selections are rejected before coordinator dispatch", async () => {
  const store = new InMemoryWorkflowStore();
  const unsupported = structuredClone(definition);
  unsupported.activities[0]!.execution = {
    kind: "agent",
    harness: "codex",
    model: "missing-model",
    effort: "high",
  };
  store.definitions.set("build", unsupported);
  store.projects.set("project", {
    projectId: "project",
    name: "Project",
    absolutePath: "/tmp/project",
    daemonId: "daemon",
    gitStatus: "valid",
    blockedReason: null,
    enabledWorkflowIds: ["build"],
  });
  const response = await buildWorkflowTestApp(store).request(
    "/v1/workflow-runs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "unsupported-run",
        projectId: "project",
        workflowId: "build",
      }),
    },
  );
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe("UNSUPPORTED_EXECUTION_SETTINGS");
  expect(store.enqueuedRunIds).toEqual([]);
});

test("draft workflows cannot start runs", async () => {
  const store = new InMemoryWorkflowStore();
  const draft = structuredClone(definition);
  draft.status = "draft";
  store.definitions.set(draft.workflowId, draft);
  store.projects.set("project", {
    projectId: "project",
    name: "Project",
    absolutePath: "/tmp/project",
    daemonId: "daemon",
    gitStatus: "valid",
    blockedReason: null,
    enabledWorkflowIds: [draft.workflowId],
  });

  const response = await buildWorkflowTestApp(store).request("/v1/workflow-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: "draft-run", projectId: "project", workflowId: draft.workflowId }),
  });

  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe("WORKFLOW_NOT_PUBLISHED");
  expect(store.enqueuedRunIds).toEqual([]);
});

test("reused run and response identities cannot silently accept different commands", async () => {
  const store = new InMemoryWorkflowStore();
  store.definitions.set("build", definition);
  store.projects.set("project", {
    projectId: "project",
    name: "Project",
    absolutePath: "/tmp/project",
    daemonId: "daemon",
    gitStatus: "valid",
    blockedReason: null,
    enabledWorkflowIds: ["build"],
  });
  const app = buildWorkflowTestApp(store);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (
      await post("/v1/workflow-runs", {
        requestId: "identity-run",
        projectId: "project",
        workflowId: "build",
        kickoffPrompt: "Original prompt",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await post("/v1/workflow-runs", {
        requestId: "identity-run",
        projectId: "project",
        workflowId: "build",
        kickoffPrompt: "Changed prompt",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await post("/v1/workflow-runs/identity-run/commands", {
        messageId: "response-identity",
        action: "cancel",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post("/v1/workflow-runs/identity-run/commands", {
        messageId: "response-identity",
        action: "answer",
        answer: "Conflicting message",
      })
    ).status,
  ).toBe(409);
});

test("the longest accepted run identity can submit responses to its derived interactions", async () => {
  const store = new InMemoryWorkflowStore();
  const { createWorkflowRun } = await import("@factory/workflow");
  const runId = "r".repeat(160);
  const interactionId = runId + ":execution:1:dispatch:1:attempt:1:approval";
  store.runs.set(
    runId,
    createWorkflowRun(
      {
        runId,
        projectId: "project",
        daemonId: "daemon",
        workflow: definition,
        workspace: { projectPath: "/tmp/project" },
      },
      "2026-09-15T12:00:00.000Z",
    ),
  );
  const response = await buildWorkflowTestApp(store).request(
    "/v1/workflow-runs/" + runId + "/commands",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messageId: "long-identity-approval",
        interactionId,
        action: "approve",
      }),
    },
  );
  expect(response.status).toBe(200);
  expect(store.messages.size).toBe(1);
});
