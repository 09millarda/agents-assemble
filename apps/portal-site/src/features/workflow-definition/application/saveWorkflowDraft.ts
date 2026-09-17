import { normalizeWorkflowTags, type WorkflowDefinition } from "@factory/workflow";
import type { WorkflowDefinitionPort } from "../domain/WorkflowDefinitionPort";
export function saveWorkflowDraft(
  workflows: Pick<WorkflowDefinitionPort, "updateWorkflow">,
  draft: WorkflowDefinition,
): Promise<WorkflowDefinition> {
  return workflows.updateWorkflow({
    ...draft,
    name: draft.name.trim() || draft.name,
    tags: normalizeWorkflowTags(draft.tags),
    activities: draft.activities.map((activity) => ({
      ...activity,
      name: activity.name.trim() || activity.name,
    })),
  });
}
