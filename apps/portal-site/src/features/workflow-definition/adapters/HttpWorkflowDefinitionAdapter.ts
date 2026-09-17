import type { WorkflowDefinition } from "@factory/workflow";
import { FactoryHttpClient } from "../../../infrastructure/http/FactoryHttpClient";
import type { WorkflowDefinitionPort } from "../domain/WorkflowDefinitionPort";
export class HttpWorkflowDefinitionAdapter implements WorkflowDefinitionPort {
  private readonly http: FactoryHttpClient;
  constructor(baseUrl?: string) {
    this.http = new FactoryHttpClient(baseUrl);
  }
  listWorkflows(): Promise<WorkflowDefinition[]> {
    return this.http.list("/v1/workflows");
  }
  getWorkflow(workflowId: string): Promise<WorkflowDefinition> {
    return this.http.request(`/v1/workflows/${encodeURIComponent(workflowId)}`);
  }
  createWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    return this.http.post("/v1/workflows", definition);
  }
  updateWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    return this.http.post(
      `/v1/workflows/${encodeURIComponent(definition.workflowId)}/update`,
      definition,
    );
  }
  deleteWorkflow(workflowId: string): Promise<{ deleted: true }> {
    return this.http.post(
      `/v1/workflows/${encodeURIComponent(workflowId)}/delete`,
      {},
    );
  }
}
