import { expect, test } from "bun:test";
import { setProjectName } from "./setProjectName";

test("updates a project name with the trimmed value", async () => {
  const result = await setProjectName(
    {
      setProjectName: async (_projectId, name) => ({
        projectId: "project-1",
        name,
        absolutePath: "/tmp/project",
        daemonId: null,
        gitStatus: "unknown",
        blockedReason: null,
        enabledWorkflowIds: [],
        setupCommand: null,
      }),
    },
    "project-1",
    "  Portal  ",
  );

  expect(result).toEqual({
    ok: true,
    value: {
      projectId: "project-1",
      name: "Portal",
      absolutePath: "/tmp/project",
      daemonId: null,
      gitStatus: "unknown",
      blockedReason: null,
      enabledWorkflowIds: [],
      setupCommand: null,
    },
  });
});

test("rejects a blank project name without writing", async () => {
  let writes = 0;
  const result = await setProjectName(
    {
      setProjectName: async () => {
        writes += 1;
        return null;
      },
    },
    "project-1",
    "   ",
  );

  expect(result).toEqual({
    ok: false,
    error: {
      code: "INVALID_PROJECT_NAME",
      message: "Project name must be 1-100 characters.",
    },
  });
  expect(writes).toBe(0);
});

test("returns a not-found result when the project does not exist", async () => {
  const result = await setProjectName(
    { setProjectName: async () => null },
    "missing-project",
    "Portal",
  );

  expect(result).toEqual({
    ok: false,
    error: { code: "PROJECT_NOT_FOUND", message: "Project does not exist." },
  });
});
