import type {
  WorkflowCatalogFilters,
  WorkflowDefinition,
} from "@factory/workflow";
export interface WorkflowDefinitionPort {
  listWorkflows(filters?: WorkflowCatalogFilters): Promise<WorkflowDefinition[]>;
  getWorkflow(workflowId: string): Promise<WorkflowDefinition>;
  createWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
  updateWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
  publishWorkflow(workflowId: string): Promise<WorkflowDefinition>;
  unpublishWorkflow(workflowId: string): Promise<WorkflowDefinition>;
  deleteWorkflow(workflowId: string): Promise<{ deleted: true }>;
}
