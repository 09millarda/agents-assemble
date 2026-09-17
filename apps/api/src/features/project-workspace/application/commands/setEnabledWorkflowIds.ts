import type { ProjectInfo, Result } from "@factory/shared-domain";
import type { ProjectRegistryPort } from "../../domain/ProjectWorkspacePort";

export async function setEnabledWorkflowIds(
  registry: ProjectRegistryPort,
  projectId: string,
  workflowIds: string[]
): Promise<Result<ProjectInfo, { code: string; message: string }>> {
  if (!projectId) return { ok: false, error: { code: "INVALID_REQUEST", message: "Project is required." } };
  const deduped = [...new Set(workflowIds.map((workflowId) => workflowId.trim()).filter((workflowId) => workflowId.length > 0))];
  const updated = await registry.setEnabledWorkflowIds(projectId, deduped);
  if (!updated) return { ok: false, error: { code: "PROJECT_NOT_FOUND", message: "Project does not exist." } };
  return { ok: true, value: updated };
}
