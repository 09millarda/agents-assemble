import type { ProjectInfo, Result } from "@factory/shared-domain";
import { isWorkflowPublished } from "@factory/workflow";
import type {
  ProjectRegistryPort,
  WorkflowAvailabilityPort,
} from "../../domain/ProjectWorkspacePort";

export async function setEnabledWorkflowIds(
  registry: ProjectRegistryPort,
  workflows: WorkflowAvailabilityPort,
  projectId: string,
  workflowIds: string[]
): Promise<Result<ProjectInfo, { code: string; message: string }>> {
  if (!projectId) return { ok: false, error: { code: "INVALID_REQUEST", message: "Project is required." } };
  if (!(await registry.findProject(projectId)))
    return {
      ok: false,
      error: { code: "PROJECT_NOT_FOUND", message: "Project does not exist." },
    };
  const deduped = [...new Set(workflowIds.map((workflowId) => workflowId.trim()).filter((workflowId) => workflowId.length > 0))];
  for (const workflowId of deduped) {
    const definition = await workflows.findDefinition(workflowId);
    if (!definition)
      return {
        ok: false,
        error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow does not exist." },
      };
    if (!isWorkflowPublished(definition.status))
      return {
        ok: false,
        error: {
          code: "WORKFLOW_NOT_PUBLISHED",
          message: "Only Published workflows can be enabled.",
        },
      };
  }
  const updated = await registry.setEnabledWorkflowIds(projectId, deduped);
  if (!updated) return { ok: false, error: { code: "PROJECT_NOT_FOUND", message: "Project does not exist." } };
  return { ok: true, value: updated };
}
