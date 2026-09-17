import { isProjectNameValid } from "@factory/shared-domain";
import type { ProjectInfo, Result } from "@factory/shared-domain";
import type { ProjectRegistryPort } from "../../domain/ProjectWorkspacePort";

export async function setProjectName(
  registry: Pick<ProjectRegistryPort, "setProjectName">,
  projectId: string,
  name: string,
): Promise<Result<ProjectInfo, { code: string; message: string }>> {
  if (!projectId)
    return {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Project is required." },
    };
  if (!isProjectNameValid(name))
    return {
      ok: false,
      error: {
        code: "INVALID_PROJECT_NAME",
        message: "Project name must be 1-100 characters.",
      },
    };
  const updated = await registry.setProjectName(projectId, name.trim());
  if (!updated)
    return {
      ok: false,
      error: { code: "PROJECT_NOT_FOUND", message: "Project does not exist." },
    };
  return { ok: true, value: updated };
}
