import { describe, expect, test } from "bun:test";
import { createProject } from "./createProject";
import { assignDaemonToProject } from "./assignDaemonToProject";
import { setEnabledWorkflowIds } from "./setEnabledWorkflowIds";
import type { ProjectRegistryPort } from "../../domain/ProjectWorkspacePort";
import type { ProjectInfo } from "@factory/shared-domain";

function stubRegistry(overrides: Partial<ProjectRegistryPort> = {}): ProjectRegistryPort {
  return {
    createProject: async (input) => ({ projectId: "p1", name: input.name, absolutePath: input.absolutePath, daemonId: null, gitStatus: "unknown", blockedReason: null, enabledWorkflowIds: [] }),
    listProjects: async () => [],
    findProject: async () => null,
    setProjectName: async () => null,
    assignDaemon: async () => null,
    setEnabledWorkflowIds: async () => null,
    setSetupCommand: async () => null,
    markGitStatus: async () => {},
    ...overrides,
  };
}

describe("createProject", () => {
  test("rejects relative paths", async () => {
    const result = await createProject(stubRegistry(), { name: "site", absolutePath: "relative/path" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_PROJECT_PATH");
  });

  test("creates with an absolute path", async () => {
    const result = await createProject(stubRegistry(), { name: "site", absolutePath: "/tmp/site" });
    expect(result.ok).toBe(true);
  });
});

describe("setEnabledWorkflowIds", () => {
  test("replaces the allow-list and dedupes entries", async () => {
    let stored: string[] = [];
    const registry = stubRegistry({
      setEnabledWorkflowIds: async (_projectId, workflowIds) => {
        stored = workflowIds;
        return { projectId: "p1", name: "site", absolutePath: "/tmp/site", daemonId: "d1", gitStatus: "valid", blockedReason: null, enabledWorkflowIds: workflowIds };
      },
    });
    const result = await setEnabledWorkflowIds(registry, "p1", ["workflow-b", "workflow-a", "workflow-a", "  "]);
    expect(result.ok).toBe(true);
    expect(stored).toEqual(["workflow-b", "workflow-a"]);
    if (result.ok) expect(result.value.enabledWorkflowIds).toEqual(["workflow-b", "workflow-a"]);
  });

  test("returns 404 shape when the project is unknown", async () => {
    const missing = await setEnabledWorkflowIds(stubRegistry(), "missing", ["workflow-a"]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("PROJECT_NOT_FOUND");
    const assigned = await assignDaemonToProject(stubRegistry(), "missing", "d1");
    expect(assigned.ok).toBe(false);
  });
});
