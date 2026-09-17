import type { ProjectInfo, Result } from "@factory/shared-domain";
import type { ProjectRegistryPort } from "../../domain/ProjectWorkspacePort";
export async function setProjectSetupCommand(
  registry: Pick<ProjectRegistryPort, "setSetupCommand">,
  projectId: string,
  setupCommand: string | null,
): Promise<Result<ProjectInfo, { code: string; message: string }>> {
  const project = await registry.setSetupCommand(projectId, setupCommand);
  return project
    ? { ok: true, value: project }
    : {
        ok: false,
        error: {
          code: "PROJECT_NOT_FOUND",
          message: "Project does not exist.",
        },
      };
}
