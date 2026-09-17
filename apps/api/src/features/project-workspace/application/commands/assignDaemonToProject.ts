import type { ProjectInfo, Result } from "@factory/shared-domain";
import type { ProjectRegistryPort } from "../../domain/ProjectWorkspacePort";

export async function assignDaemonToProject(
  registry: ProjectRegistryPort,
  projectId: string,
  daemonId: string
): Promise<Result<ProjectInfo, { code: string; message: string }>> {
  if (!projectId || !daemonId) return { ok: false, error: { code: "INVALID_REQUEST", message: "Project and daemon are required." } };
  const updated = await registry.assignDaemon(projectId, daemonId);
  if (!updated) return { ok: false, error: { code: "PROJECT_NOT_FOUND", message: "Project does not exist." } };
  return { ok: true, value: updated };
}
