import {
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowCatalogPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
export async function saveWorkflowDefinition(
  store: WorkflowCatalogPort,
  definition: WorkflowDefinition,
): Promise<Result<WorkflowDefinition, WorkflowError>> {
  const invalid = validateWorkflowDefinition(definition);
  if (invalid)
    return { ok: false, error: { code: "INVALID_WORKFLOW", message: invalid } };
  return { ok: true, value: await store.saveDefinition(definition) };
}
