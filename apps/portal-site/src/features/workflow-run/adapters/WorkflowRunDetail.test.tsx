import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { WorkflowRun } from "@factory/workflow";
import { WorkflowRunView } from "./WorkflowRunDetail";

test("reopening a run renders its saved transcript, session, pending question and retained workspace", () => {
  const activity = {
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
  const run: WorkflowRun = {
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
      activities: [activity],
      positions: { requirements: { x: 10, y: 20 } },
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
        activity,
        status: "awaiting-human",
        inputRevisionIds: [],
        outputRevisionIds: [],
        sessionId: "session-1",
        transcript: [
          {
            entryId: "entry-1",
            role: "assistant",
            content: "What should this feature do?",
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
  };
  const html = renderToString(
    <WorkflowRunView run={run} busy={false} onRespond={async () => {}} />,
  );
  for (const value of [
    "What should this feature do?",
    "session-1",
    "question-1",
    "/run-checkout",
    "pinned-commit",
    "Setup succeeded",
    "chosen-model",
    "high",
    "Send answer",
  ])
    expect(html).toContain(value);
});
