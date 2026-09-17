import {
  filterWorkflowDefinitions,
  type WorkflowCatalogFilters,
  type WorkflowDefinition,
} from "@factory/workflow";
import type { WorkflowCatalogPort } from "../../domain/WorkflowStorePort";
export function listWorkflowDefinitions(
  store: WorkflowCatalogPort,
  filters: WorkflowCatalogFilters = {},
): Promise<WorkflowDefinition[]> {
  return store
    .listDefinitions()
    .then((definitions) => filterWorkflowDefinitions(definitions, filters));
}
