import { normalizeWorkflowTags, type WorkflowStatus } from "./workflowLifecycle";
import type { WorkflowDefinition } from "./WorkflowDefinition";

export interface WorkflowCatalogFilters {
  search?: string;
  status?: WorkflowStatus;
  tags?: string[];
}

export function filterWorkflowDefinitions(
  workflows: WorkflowDefinition[],
  filters: WorkflowCatalogFilters,
): WorkflowDefinition[] {
  const search = filters.search?.trim().toLowerCase() ?? "";
  const tags = normalizeWorkflowTags(filters.tags ?? []);
  return workflows.filter(
    (workflow) =>
      (!search || workflow.name.toLowerCase().includes(search)) &&
      (!filters.status || workflow.status === filters.status) &&
      tags.every((tag) => workflow.tags.includes(tag)),
  );
}
