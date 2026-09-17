import type { WorkflowDefinition } from "@factory/workflow";
export interface WorkflowDefinitionPort {
  listWorkflows(): Promise<WorkflowDefinition[]>;
  getWorkflow(workflowId: string): Promise<WorkflowDefinition>;
  createWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
  updateWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
  deleteWorkflow(workflowId: string): Promise<{ deleted: true }>;
}
