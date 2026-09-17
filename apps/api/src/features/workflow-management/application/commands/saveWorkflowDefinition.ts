import {
  normalizeWorkflowTags,
  validateWorkflowDefinition,
  type WorkflowDefinitionInput,
  type WorkflowDefinition,
} from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowCatalogPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
export async function saveWorkflowDefinition(
  store: WorkflowCatalogPort,
  definition: WorkflowDefinitionInput,
): Promise<Result<WorkflowDefinition, WorkflowError>> {
  const candidate: WorkflowDefinition = {
    ...definition,
    status: "draft",
    tags: normalizeWorkflowTags(definition.tags),
  };
  const invalid = validateWorkflowDefinition(candidate);
  if (invalid)
    return { ok: false, error: { code: "INVALID_WORKFLOW", message: invalid } };
  return { ok: true, value: await store.saveDefinition(candidate) };
}
