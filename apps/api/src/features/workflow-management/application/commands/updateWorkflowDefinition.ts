import {
  normalizeWorkflowTags,
  validateWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowDefinitionInput,
} from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowCatalogPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
import { getWorkflowDefinition } from "../queries/getWorkflowDefinition";
export async function updateWorkflowDefinition(
  store: WorkflowCatalogPort,
  workflowId: string,
  resource: WorkflowDefinitionInput,
): Promise<Result<WorkflowDefinition, WorkflowError>> {
  if (resource.workflowId !== workflowId)
    return {
      ok: false,
      error: {
        code: "IDENTITY_MISMATCH",
        message: "Resource identity cannot change.",
      },
    };
  const existing = await getWorkflowDefinition(store, workflowId);
  if (!existing.ok) return existing;
  const candidate: WorkflowDefinition = {
    ...resource,
    status: existing.value.status,
    tags: normalizeWorkflowTags(resource.tags),
  };
  const invalid = validateWorkflowDefinition(candidate);
  if (invalid)
    return { ok: false, error: { code: "INVALID_WORKFLOW", message: invalid } };
  return { ok: true, value: await store.saveDefinition(candidate) };
}
