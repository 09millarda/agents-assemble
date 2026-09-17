import { expect, test } from "bun:test";
import { createWorkflowRun, advanceWorkflowRun } from "./advanceWorkflowRun";
import { buildCommand } from "../domain/buildWorkflowDaemonCommand";
import type { WorkflowDefinition } from "../../workflow-definition/domain/WorkflowDefinition";
const now = "2026-09-15T10:00:00.000Z";
function definition(): WorkflowDefinition {
  return {
    workflowId: "feature",
    name: "Feature building",
    description: "",
    positions: {
      requirements: { x: 10, y: 20 },
      implement: { x: 300, y: 20 },
    },
    activities: [
      {
        activityId: "requirements",
        name: "Establish requirements",
        description: "UI-only note",
        instructions: "Interview the user",
        humanInput: "input",
        execution: { kind: "agent", harness: "codex", model: "gpt-5.6-sol", effort: "medium" },
        outcomes: [{ name: "ready", handoff: { targetActivityId: "implement", continuation: "approval" } }],
      },
      {
        activityId: "implement",
        name: "Implement",
        description: "",
        instructions: "Build it",
        humanInput: "off",
        execution: { kind: "agent", harness: "codex", model: "gpt-5.3-codex", effort: "high" },
        outcomes: [{ name: "done", handoff: { targetActivityId: null, continuation: "automatic" } }],
      },
    ],
  };
}
function queued(workflow?: WorkflowDefinition) {
  return createWorkflowRun(
    { runId: "run-1", projectId: "project-1", daemonId: "daemon-1", workflow: workflow ?? definition(), workspace: { projectPath: "/project" } },
    now,
  );
}
test("start uses the node with no incoming edges and freezes positions plus per-edge approval", () => {
  const workflow = definition();
  workflow.activities.reverse();
  const started = advanceWorkflowRun(queued(workflow), { kind: "start", messageId: "start-1" }, now);
  expect(started.run.snapshot.activities[0]!.activityId).toBe("implement");
  expect(started.run.snapshot.positions).toEqual({ requirements: { x: 10, y: 20 }, implement: { x: 300, y: 20 } });
  expect(started.run.executions[0]!.activityId).toBe("requirements");
  expect(started.commands[0]!.activity.outcomes).toEqual([
    { name: "ready", handoff: { targetActivityId: "implement", continuation: "approval" } },
  ]);
});
test("approval handoff waits while terminal nodes end the run", () => {
  const started = advanceWorkflowRun(queued(), { kind: "start", messageId: "start-1" }, now);
  const execution = started.run.executions[0]!;
  const waiting = advanceWorkflowRun(started.run, { kind: "fact", fact: { factId: "done-1", runId: "run-1", commandId: execution.commandId, executionId: execution.executionId, type: "completed", completion: { outcome: "ready" } } }, now);
  expect(waiting.run.status).toBe("awaiting-human");
  expect(waiting.run.interaction?.targetActivityId).toBe("implement");
  const approved = advanceWorkflowRun(waiting.run, { kind: "human", response: { messageId: "ok-1", runId: "run-1", interactionId: waiting.run.interaction!.interactionId, action: "approve" } }, now);
  expect(approved.run.executions.at(-1)!.activityId).toBe("implement");
  const finishing = approved.run.executions.at(-1)!;
  const done = advanceWorkflowRun(approved.run, { kind: "fact", fact: { factId: "done-2", runId: "run-1", commandId: finishing.commandId, executionId: finishing.executionId, type: "completed", completion: { outcome: "done" } } }, now);
  expect(done.run.status).toBe("completed");
});
test("free cycles pass and empty canvas completes", () => {
  const workflow = definition();
  workflow.activities[1]!.outcomes = [{ name: "again", handoff: { targetActivityId: "requirements", continuation: "automatic" } }];
  const started = advanceWorkflowRun(queued(workflow), { kind: "start", messageId: "start-1" }, now);
  expect(started.run.executions[0]!.activityId).toBe("requirements");
  const empty = advanceWorkflowRun(queued({ workflowId: "blank", name: "Blank", description: "", activities: [], positions: {} }), { kind: "start", messageId: "start-1" }, now);
  expect(empty.run.status).toBe("completed");
});
test("description never reaches the harness prompt", () => {
  const started = advanceWorkflowRun(queued(), { kind: "start", messageId: "start-1" }, now);
  const command = buildCommand(started.run, started.run.executions[0]!, "execute");
  expect(command.activity.description).toBe("UI-only note");
  expect(command.activity.instructions).toBe("Interview the user");
});
test("questions survive serialization and duplicates cannot dispatch", () => {
  const started = advanceWorkflowRun(queued(), { kind: "start", messageId: "start-1" }, now);
  const command = started.commands[0]!;
  const waiting = advanceWorkflowRun(started.run, { kind: "fact", fact: { factId: "q-1", runId: "run-1", commandId: command.commandId, executionId: command.executionId, type: "question", message: "What should we build?", sessionId: "s-1", interactionId: "q-1" } }, now);
  expect(waiting.run.status).toBe("awaiting-human");
  const resumed = advanceWorkflowRun(JSON.parse(JSON.stringify(waiting.run)), { kind: "human", response: { messageId: "a-1", runId: "run-1", interactionId: "q-1", action: "answer", answer: "Search page" } }, now);
  expect(resumed.commands[0]).toMatchObject({ kind: "answer", sessionId: "s-1" });
  expect(advanceWorkflowRun(resumed.run, { kind: "human", response: { messageId: "a-1", runId: "run-1", interactionId: "q-1", action: "answer", answer: "Search page" } }, now).commands).toEqual([]);
});
