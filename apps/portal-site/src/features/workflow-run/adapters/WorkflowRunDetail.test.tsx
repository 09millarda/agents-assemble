import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { WorkflowRun } from "@factory/workflow";
import { RunDetails, WorkflowRunView } from "./WorkflowRunDetail";

const firstActivity = {
  activityId: "requirements",
  name: "Establish requirements",
  instructions: "Interview",
  humanInput: "input" as const,
  description: "",
  execution: {
    kind: "agent" as const,
    harness: "codex" as const,
    model: "chosen-model",
    effort: "high",
  },
  outcomes: [],
};

const secondActivity = {
  ...firstActivity,
  activityId: "build",
  name: "Build feature",
};

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: "run-1",
    name: "Build feature",
    projectId: "project",
    workflowId: "workflow",
    daemonId: "daemon",
    recipientId: null,
    snapshot: {
      workflowId: "workflow",
      name: "Build feature",
      description: "A feature workflow",
      status: "published",
      tags: [],
      activities: [firstActivity, secondActivity],
      positions: {},
    },
    workspace: { projectPath: "/original" },
    workspaceResult: {
      worktreePath: "/run-checkout",
      branch: "codex/run-1",
      pinnedCommit: "pinned-commit",
      setupLog: "Setup succeeded",
    },
    kickoffPrompt: null,
    status: "awaiting-human",
    executions: [
      {
        executionId: "execution-1",
        activityId: "requirements",
        activity: firstActivity,
        status: "awaiting-human",
        inputRevisionIds: [],
        outputRevisionIds: [],
        sessionId: "session-1",
        transcript: [
          {
            entryId: "entry-1",
            role: "assistant",
            content: "Internal reasoning trace",
            createdAt: "2026-09-15T12:00:00.000Z",
          },
        ],
        dispatchSequence: 1,
        harnessTurnIds: ["turn-1"],
        recoveryAttempt: 0,
        commandId: "command-1",
        outcome: null,
        error: null,
      },
    ],
    documents: [],
    interaction: {
      interactionId: "question-1",
      executionId: "execution-1",
      kind: "question",
      prompt: "What should this feature do?",
      outputRevisionIds: [],
      targetActivityId: null,
    },
    loopPasses: {},
    loopLimits: {},
    processedMessageIds: [],
    approvedTreeHash: null,
    acceptedFindings: false,
    acceptedFindingRevisionIds: [],
    publication: null,
    error: null,
    createdAt: "2026-09-15T12:00:00.000Z",
    updatedAt: "2026-09-15T12:00:00.000Z",
    ...overrides,
  };
}

async function renderView(run: WorkflowRun): Promise<string> {
  const rootRoute = createRootRoute({
    component: () => (
      <WorkflowRunView
        run={run}
        projectId={run.projectId}
        projectName="Portal"
        busy={false}
        deleting={false}
        notifications={[]}
        onRespond={async () => {}}
        onDelete={async () => {}}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);
  router.history.destroy();
  return html;
}

const BANNED_OVERVIEW_WORDS = ["reconciliation", "recovery", "dispatch", "attempt"];

test("overview shows step position and the plain-language action without technical details", async () => {
  const html = await renderView(makeRun());
  for (const value of [
    "Step 1 of 2",
    "Establish requirements",
    "Needs your input",
    "What should this feature do?",
    "Send answer",
    "Cancel run",
    "Delete run",
    "Cancel the run before deleting it.",
    "Projects",
    "Runs",
    "Build feature",
    "Overview",
    "Details",
  ])
    expect(html).toContain(value);
  for (const hidden of [
    "/run-checkout",
    "pinned-commit",
    "Setup succeeded",
    "session-1",
    "question-1",
    "Internal reasoning trace",
    "chosen-model",
    "Frozen workflow definition",
    "Run workspace",
    "Workflow graph",
    "Activity executions",
  ])
    expect(html).not.toContain(hidden);
  const lowered = html.toLowerCase();
  for (const banned of BANNED_OVERVIEW_WORDS) expect(lowered).not.toContain(banned);
});

test("overview shows plain-language errors with position", async () => {
  const html = await renderView(
    makeRun({ status: "failed", interaction: null, error: "The step could not finish." }),
  );
  expect(html).toContain("Something went wrong");
  expect(html).toContain("The step could not finish.");
  expect(html).toContain("Failed");
  expect(html).toContain("Stopped at step 1 of 2");
  expect(html).not.toContain("Run workspace");
  const lowered = html.toLowerCase();
  for (const banned of BANNED_OVERVIEW_WORDS) expect(lowered).not.toContain(banned);
});

test("failed-step recovery uses plain retry wording without jargon", async () => {
  const html = await renderView(
    makeRun({
      status: "recovery-required",
      interaction: {
        interactionId: "recovery-1",
        executionId: "execution-1",
        kind: "recovery",
        prompt: "The build step stopped before finishing.",
        outputRevisionIds: [],
        targetActivityId: null,
      },
    }),
  );
  for (const value of ["Step failed", "Retry step", "Cancel run", "Step 1 of 2"])
    expect(html).toContain(value);
  const lowered = html.toLowerCase();
  for (const banned of BANNED_OVERVIEW_WORDS) expect(lowered).not.toContain(banned);
});

test("cancel stays available while active and delete unlocks once terminal", async () => {
  for (const status of ["queued", "running", "awaiting-human", "recovery-required"] as const) {
    const html = await renderView(makeRun({ status }));
    expect(html).toContain("Cancel run");
    expect(html).toContain("Cancel the run before deleting it.");
  }
  for (const status of ["completed", "cancelled", "failed"] as const) {
    const html = await renderView(makeRun({ status, interaction: null }));
    expect(html).toContain("Delete run");
    expect(html).not.toContain("Cancel the run before deleting it.");
  }
});

test("details holds the graph, workspace, executions, documents, and notifications", () => {
  const run = makeRun({
    documents: [
      {
        revisionId: "revision-1",
        runId: "run-1",
        documentId: "plan",
        name: "Implementation plan",
        revision: 1,
        executionId: "execution-1",
        activityId: "requirements",
        content: "# Plan",
        consumedRevisionIds: [],
        createdAt: "2026-09-15T12:00:00.000Z",
      },
    ],
  });
  const html = renderToString(
    <RunDetails
      run={run}
      busy={false}
      notifications={[
        {
          notificationId: "notice-1",
          runId: "run-1",
          recipientId: null,
          kind: "question",
          title: "Needs input",
          body: "Answer needed",
          url: "/projects/project/runs/run-1",
          deliveryStatus: "pending",
          attempts: 0,
          lastError: null,
          createdAt: "2026-09-15T12:00:00.000Z",
        },
      ]}
      onRespond={async () => {}}
    />,
  );
  for (const value of [
    "Workflow graph",
    "Run workspace",
    "/run-checkout",
    "pinned-commit",
    "Activity executions",
    "session-1",
    "Internal reasoning trace",
    "Implementation plan",
    "Notifications",
    "Needs input",
    "Frozen workflow definition",
  ])
    expect(html).toContain(value);
});

test("breadcrumbs show the project name instead of the project id", async () => {
  const html = await renderView(makeRun());
  expect(html).toContain("Portal");
  expect(html).toContain("Runs");
  expect(html).not.toContain(">project<");
});
