import { isAbsoluteProjectPath, isProjectNameValid } from "@factory/shared-domain";
import type { ProjectInfo, Result } from "@factory/shared-domain";
import type { ProjectRegistryPort } from "../../domain/ProjectWorkspacePort";

export async function createProject(
  registry: ProjectRegistryPort,
  input: { name: string; absolutePath: string }
): Promise<Result<ProjectInfo, { code: string; message: string }>> {
  if (!isProjectNameValid(input.name)) return { ok: false, error: { code: "INVALID_PROJECT_NAME", message: "Project name must be 1-100 characters." } };
  if (!isAbsoluteProjectPath(input.absolutePath)) return { ok: false, error: { code: "INVALID_PROJECT_PATH", message: "Project path must be absolute." } };
  return { ok: true, value: await registry.createProject(input) };
}
