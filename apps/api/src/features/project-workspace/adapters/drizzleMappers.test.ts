import { describe, expect, test } from "bun:test";
import { toProjectInfo } from "./DrizzleProjectRegistryAdapter";

describe("project mappers", () => {
  test("carries the enabled-workflow allow-list and derives blocked reasons", async () => {
    const row = { projectId: "p1", name: "site", absolutePath: "/tmp/site", daemonId: "d1", gitStatus: "not-a-repo", blockedReason: null };
    expect(toProjectInfo(row, ["workflow-b", "workflow-a"]).enabledWorkflowIds).toEqual(["workflow-a", "workflow-b"]);
    expect(toProjectInfo(row, []).blockedReason).toBe("Project path is not a git repository.");
    expect(toProjectInfo({ ...row, gitStatus: "valid", blockedReason: null }, []).blockedReason).toBeNull();
  });
});
