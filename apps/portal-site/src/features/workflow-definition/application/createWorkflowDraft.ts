import type { WorkflowDefinition } from "@factory/workflow";
import { createWorkflowFromTemplate, type WorkflowTemplateId } from "../domain/workflowTemplates";

export function createWorkflowDraft(
  templateId: WorkflowTemplateId,
  workflowId: string,
  name: string,
  description: string,
): WorkflowDefinition {
  return {
    ...createWorkflowFromTemplate(templateId),
    workflowId,
    name,
    description,
  };
}
