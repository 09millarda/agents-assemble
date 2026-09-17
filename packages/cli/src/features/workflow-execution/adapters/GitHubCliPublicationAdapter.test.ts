import { expect, test } from "bun:test";
import { GitHubCliPublicationAdapter } from "./GitHubCliPublicationAdapter";
import type { WorkflowDaemonCommand } from "@factory/workflow";
test("publication was removed with built-in actions but cancellation still resolves", async () => {
  const adapter = new GitHubCliPublicationAdapter("/tmp", async () => "", async (workspace) => workspace);
  await adapter.cancel("missing-run");
  const command = {
    commandId: "publish-command",
    executionId: "publish-execution",
    runId: "publish-run",
    daemonId: "daemon-1",
    kind: "execute",
    kickoffPrompt: null,
    activity: {
      activityId: "publish",
      name: "Publish",
      description: "",
      instructions: "",
      humanInput: "off",
      execution: { kind: "agent", harness: "codex", model: "gpt-5.6-sol", effort: "medium" },
      outcomes: [{ name: "done", handoff: { targetActivityId: null, continuation: "automatic" } }],
    },
    workspace: { projectPath: "/project" },
    documents: [],
    documentContracts: [],
  } as unknown as WorkflowDaemonCommand;
  await expect(adapter.publish(command, { worktreePath: "/run", branch: "b", pinnedCommit: "c" })).rejects.toThrow("removed");
});
