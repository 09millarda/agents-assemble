import type { HumanResponse, WorkflowRun } from "@factory/workflow";
import { FactoryHttpClient } from "../../../infrastructure/http/FactoryHttpClient";
import type {
  StartWorkflowRun,
  RunNotification,
  WorkflowRunPort,
} from "../domain/WorkflowRunPort";

export class HttpWorkflowRunAdapter implements WorkflowRunPort {
  private readonly http: FactoryHttpClient;
  constructor(baseUrl?: string) {
    this.http = new FactoryHttpClient(baseUrl);
  }
  startRun(input: StartWorkflowRun): Promise<WorkflowRun> {
    return this.http.post("/v1/workflow-runs", input);
  }
  listRuns(projectId?: string): Promise<WorkflowRun[]> {
    return this.http.list(
      `/v1/workflow-runs${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
    );
  }
  getRun(runId: string): Promise<WorkflowRun> {
    return this.http.request(`/v1/workflow-runs/${encodeURIComponent(runId)}`);
  }
  listNotifications(runId: string): Promise<RunNotification[]> {
    return this.http.list(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/notifications`,
    );
  }
  async submitCommand(response: HumanResponse): Promise<void> {
    const { runId, ...command } = response;
    await this.http.post(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/commands`,
      command,
    );
  }
}
