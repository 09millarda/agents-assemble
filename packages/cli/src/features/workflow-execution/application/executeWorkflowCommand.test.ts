import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  WorkflowDaemonCommand,
  WorkflowDaemonFact,
} from "@factory/workflow";
import type { HarnessExecutionPort } from "../domain/HarnessExecutionPort";
import { FileExecutionJournalAdapter } from "../adapters/FileExecutionJournalAdapter";
import { executeWorkflowCommand } from "./executeWorkflowCommand";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.map((path) => rm(path, { recursive: true, force: true })),
  );
});
const command: WorkflowDaemonCommand = {
  commandId: "command-1",
  executionId: "execution-1",
  runId: "run-1",
  daemonId: "daemon-1",
  kind: "execute",
  kickoffPrompt: "Build it",
  activity: {
    activityId: "implement",
    name: "Implement",
    instructions: "Build it",
    execution: {
      kind: "agent",
      harness: "codex",
      model: "gpt-5.4",
      effort: "high",
    },
    humanInput: "approval",
    description: "",
    outcomes: [
      {
        name: "success",
        handoff: { targetActivityId: null, continuation: "automatic" },
      },
    ],
  },
  workspace: { projectPath: "/project" },
  documents: [],
  documentContracts: [],
};
const workspaceResult = {
  worktreePath: "/runs/run-1/worktree",
  branch: "codex/workflow-run-1",
  pinnedCommit: "commit-1",
  treeHash: "tree-1",
  diff: "diff",
};
const workspace = {
  cancel: async () => {},
  prepare: async () => workspaceResult,
  materialize: async () => "/runs/run-1/documents/execution-1",
  inspect: async () => workspaceResult,
};
const publisher = {
  cancel: async () => {},
  publish: async () => ({ url: "https://github.com/owner/repo/pull/1" }),
};

test("duplicate commands replay durable completion identities and never execute the harness twice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-command-"));
  directories.push(directory);
  const journal = new FileExecutionJournalAdapter(directory);
  const harness: HarnessExecutionPort = {
    discover: async () => {
      throw new Error("not used");
    },
    cancel: async () => {},
    execute: async (_command, suppliedWorkspace, _inputs, emit) => {
      expect(suppliedWorkspace.worktreePath).toBe("/runs/run-1/worktree");
      await emit({
        type: "progress",
        message: "building",
        sessionId: "session-1",
      });
      return {
        status: "completed",
        sessionId: "session-1",
        completion: {
          outcome: "success",
          outputs: [{ documentId: "summary", content: "# Summary\nBuilt." }],
        },
      };
    },
  };
  const facts: WorkflowDaemonFact[] = [];
  await executeWorkflowCommand(
    command,
    { journal, workspace, harness, publisher },
    async (fact) => {
      facts.push(fact);
    },
  );
  const replay: WorkflowDaemonFact[] = [];
  const restartedHarness = {
    ...harness,
    execute: async () => {
      throw new Error("Must never rerun a completed command.");
    },
  };
  await executeWorkflowCommand(
    command,
    {
      journal: new FileExecutionJournalAdapter(directory),
      workspace,
      harness: restartedHarness,
      publisher,
    },
    async (fact) => {
      replay.push(fact);
    },
  );
  expect(replay).toEqual(facts);
  expect(facts.at(-1)).toMatchObject({
    factId: "command-1:2",
    commandId: "command-1",
    executionId: "execution-1",
    type: "completed",
    workspaceResult,
    sessionId: "session-1",
    completion: {
      outcome: "success",
      outputs: [{ documentId: "summary", content: "# Summary\nBuilt." }],
    },
  });
});

test("reconciliation recovers a completed execution under the new command identity without another harness turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-reconcile-"));
  directories.push(directory);
  const journal = new FileExecutionJournalAdapter(directory);
  await journal.receive(command.commandId, command.executionId, command.runId);
  await journal.begin(command.commandId);
  await journal.finish(command.commandId, {
    type: "completed",
    factId: "command-1:2",
    commandId: "command-1",
    executionId: "execution-1",
    runId: "run-1",
    sessionId: "session-1",
    completion: {
      outcome: "success",
      outputs: [{ documentId: "summary", content: "# Summary\nBuilt." }],
    },
    workspaceResult,
  });
  const harness: HarnessExecutionPort = {
    discover: async () => {
      throw new Error("not used");
    },
    cancel: async () => {},
    execute: async () => {
      throw new Error("Must reconcile without rerunning.");
    },
  };
  const facts: WorkflowDaemonFact[] = [];
  await executeWorkflowCommand(
    { ...command, commandId: "reconcile-1", kind: "reconcile" },
    {
      journal: new FileExecutionJournalAdapter(directory),
      workspace,
      harness,
      publisher,
    },
    async (fact) => {
      facts.push(fact);
    },
  );
  expect(facts.at(-1)).toMatchObject({
    type: "completed",
    commandId: "reconcile-1",
    sessionId: "session-1",
    completion: {
      outcome: "success",
      outputs: [{ documentId: "summary", content: "# Summary\nBuilt." }],
    },
  });
});

test("an interrupted command requires an explicit recovery authorization before a new command can run that execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-interrupted-"));
  directories.push(directory);
  const original = new FileExecutionJournalAdapter(directory);
  await original.receive(command.commandId, command.executionId, command.runId);
  await original.begin(command.commandId);
  const harness: HarnessExecutionPort = {
    discover: async () => {
      throw new Error("not used");
    },
    cancel: async () => {},
    execute: async () => ({
      status: "completed",
      sessionId: "recovered-session",
      completion: { outcome: "success", outputs: [] },
    }),
  };
  const ports = {
    journal: new FileExecutionJournalAdapter(directory),
    workspace,
    harness,
    publisher,
  };
  const ambiguous: WorkflowDaemonFact[] = [];
  await executeWorkflowCommand(command, ports, async (fact) => {
    ambiguous.push(fact);
  });
  expect(ambiguous.at(-1)?.type).toBe("recovery_required");
  const duplicateExecution: WorkflowDaemonFact[] = [];
  await executeWorkflowCommand(
    { ...command, commandId: "other-delivery" },
    ports,
    async (fact) => {
      duplicateExecution.push(fact);
    },
  );
  expect(duplicateExecution.at(-1)?.type).toBe("recovery_required");
  const authorized: WorkflowDaemonFact[] = [];
  await executeWorkflowCommand(
    {
      ...command,
      commandId: "user-authorized-retry",
      recoveryAuthorized: true,
    },
    ports,
    async (fact) => {
      authorized.push(fact);
    },
  );
  expect(authorized.at(-1)).toMatchObject({
    type: "completed",
    sessionId: "recovered-session",
  });
});

test("reconciliation cannot replay an earlier approved document after a later revision turn was interrupted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-stale-completion-"));
  directories.push(directory);
  const journal = new FileExecutionJournalAdapter(directory);
  await journal.receive("first-output", command.executionId, command.runId);
  await journal.begin("first-output");
  await journal.finish("first-output", {
    type: "completed",
    completion: {
      outcome: "success",
      outputs: [{ documentId: "summary", content: "OLD REVISION" }],
    },
  });
  await journal.receive(
    "requested-revision",
    command.executionId,
    command.runId,
  );
  await journal.begin("requested-revision");
  const harness: HarnessExecutionPort = {
    discover: async () => {
      throw new Error("not used");
    },
    cancel: async () => {},
    execute: async () => {
      throw new Error("Ambiguous revision must not rerun.");
    },
  };
  const facts: WorkflowDaemonFact[] = [];
  await executeWorkflowCommand(
    { ...command, commandId: "reconcile-latest", kind: "reconcile" },
    {
      journal: new FileExecutionJournalAdapter(directory),
      workspace,
      harness,
      publisher,
    },
    async (fact) => {
      facts.push(fact);
    },
  );
  expect(facts.at(-1)?.type).toBe("recovery_required");
});
