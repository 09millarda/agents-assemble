import {
  createBlankWorkflow,
  createBugTriageWorkflow,
  createFeatureBuildingWorkflow,
  type WorkflowDefinition,
} from "@factory/workflow";

export type WorkflowTemplateId = "blank" | "feature-building" | "bug-triage";

export interface WorkflowTemplate {
  id: WorkflowTemplateId;
  name: string;
  summary: string;
  createWorkflow: () => WorkflowDefinition;
}

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    summary: "Start with an empty canvas and add the steps you need.",
    createWorkflow: createBlankWorkflow,
  },
  {
    id: "feature-building",
    name: "Feature building",
    summary: "Requirements, planning, implementation, and review.",
    createWorkflow: createFeatureBuildingWorkflow,
  },
  {
    id: "bug-triage",
    name: "Bug triage",
    summary: "Capture, reproduce, diagnose, fix, and verify a bug.",
    createWorkflow: createBugTriageWorkflow,
  },
];

export function createWorkflowFromTemplate(templateId: WorkflowTemplateId): WorkflowDefinition {
  return WORKFLOW_TEMPLATES.find((template) => template.id === templateId)!.createWorkflow();
}
