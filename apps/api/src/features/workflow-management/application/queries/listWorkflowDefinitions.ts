import type { WorkflowDefinition } from "@factory/workflow";
import type { WorkflowCatalogPort } from "../../domain/WorkflowStorePort";
export function listWorkflowDefinitions(
  store: WorkflowCatalogPort,
): Promise<WorkflowDefinition[]> {
  return store.listDefinitions();
}
