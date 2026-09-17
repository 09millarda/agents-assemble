import type {
  WorkflowCatalogFilters,
  WorkflowDefinition,
} from "@factory/workflow";
import { FactoryHttpClient } from "../../../infrastructure/http/FactoryHttpClient";
import type { WorkflowDefinitionPort } from "../domain/WorkflowDefinitionPort";
export class HttpWorkflowDefinitionAdapter implements WorkflowDefinitionPort {
  private readonly http: FactoryHttpClient;
  constructor(baseUrl?: string) {
    this.http = new FactoryHttpClient(baseUrl);
  }
  listWorkflows(filters: WorkflowCatalogFilters = {}): Promise<WorkflowDefinition[]> {
    const query = new URLSearchParams();
    if (filters.search?.trim()) query.set("search", filters.search.trim());
    if (filters.status) query.set("status", filters.status);
    for (const tag of filters.tags ?? []) query.append("tag", tag);
    const queryString = query.toString();
    return this.http.list(`/v1/workflows${queryString ? `?${queryString}` : ""}`);
  }
  getWorkflow(workflowId: string): Promise<WorkflowDefinition> {
    return this.http.request(`/v1/workflows/${encodeURIComponent(workflowId)}`);
  }
  createWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    return this.http.post("/v1/workflows", withoutWorkflowStatus(definition));
  }
  updateWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    return this.http.post(
      `/v1/workflows/${encodeURIComponent(definition.workflowId)}/update`,
      withoutWorkflowStatus(definition),
    );
  }
  publishWorkflow(workflowId: string): Promise<WorkflowDefinition> {
    return this.http.post(
      `/v1/workflows/${encodeURIComponent(workflowId)}/publish`,
      {},
    );
  }
  unpublishWorkflow(workflowId: string): Promise<WorkflowDefinition> {
    return this.http.post(
      `/v1/workflows/${encodeURIComponent(workflowId)}/unpublish`,
      {},
    );
  }
  deleteWorkflow(workflowId: string): Promise<{ deleted: true }> {
    return this.http.post(
      `/v1/workflows/${encodeURIComponent(workflowId)}/delete`,
      {},
    );
  }
}

function withoutWorkflowStatus(definition: WorkflowDefinition) {
  const { status: _status, ...input } = definition;
  return input;
}
