import { expect, test } from "bun:test";
import { setProjectSetupCommand } from "./setProjectSetupCommand";
test("persists optional project setup command for future run snapshots", async () => {
  const project = {
    projectId: "project",
    name: "Project",
    absolutePath: "/tmp/project",
    daemonId: null,
    gitStatus: "unknown" as const,
    blockedReason: null,
    enabledWorkflowIds: [],
    setupCommand: null as string | null,
  };
  const result = await setProjectSetupCommand(
    {
      setSetupCommand: async (_, command) => ({
        ...project,
        setupCommand: command,
      }),
    },
    "project",
    "pnpm install --frozen-lockfile",
  );
  expect(result).toEqual({
    ok: true,
    value: { ...project, setupCommand: "pnpm install --frozen-lockfile" },
  });
});
