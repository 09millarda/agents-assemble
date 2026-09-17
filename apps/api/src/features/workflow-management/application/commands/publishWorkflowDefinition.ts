import {
  isWorkflowPublished,
  normalizeWorkflowTags,
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowCatalogPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
import { getWorkflowDefinition } from "../queries/getWorkflowDefinition";

export async function publishWorkflowDefinition(
  store: WorkflowCatalogPort,
  workflowId: string,
): Promise<Result<WorkflowDefinition, WorkflowError>> {
  const existing = await getWorkflowDefinition(store, workflowId);
  if (!existing.ok) return existing;
  const invalid = validateWorkflowDefinition(existing.value);
  if (invalid)
    return { ok: false, error: { code: "INVALID_WORKFLOW", message: invalid } };
  if (isWorkflowPublished(existing.value.status)) return existing;
  return {
    ok: true,
    value: await store.saveDefinition({
      ...existing.value,
      status: "published",
      tags: normalizeWorkflowTags(existing.value.tags),
    }),
  };
}
