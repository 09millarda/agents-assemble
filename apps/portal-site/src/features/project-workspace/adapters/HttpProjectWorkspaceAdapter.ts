import type { ProjectInfo } from "@factory/shared-domain";
import type { ProjectWorkspacePort } from "../domain/ProjectWorkspacePort";

function resolveFactoryApiUrl(): string {
  return (
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_FACTORY_API_URL ?? "http://localhost:3001"
  );
}

export class HttpProjectWorkspaceAdapter implements ProjectWorkspacePort {
  constructor(private readonly baseUrl: string = resolveFactoryApiUrl()) {}

  private api(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  async listProjects(): Promise<ProjectInfo[]> {
    const response = await fetch(this.api("/v1/projects?limit=100"));
    if (!response.ok) throw new Error("Failed to load projects.");
    const body = (await response.json()) as { data: ProjectInfo[] };
    return body.data;
  }

  async createProject(input: {
    name: string;
    absolutePath: string;
  }): Promise<ProjectInfo> {
    const response = await fetch(this.api("/v1/projects"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("Failed to create project.");
    return (await response.json()) as ProjectInfo;
  }

  async setProjectName(projectId: string, name: string): Promise<ProjectInfo> {
    const response = await fetch(
      this.api(`/v1/projects/${encodeURIComponent(projectId)}/name`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    if (!response.ok) throw new Error("Failed to save project name.");
    return (await response.json()) as ProjectInfo;
  }

  async assignDaemon(
    projectId: string,
    daemonId: string,
  ): Promise<ProjectInfo> {
    const response = await fetch(
      this.api(`/v1/projects/${encodeURIComponent(projectId)}/assign`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ daemonId }),
      },
    );
    if (!response.ok) throw new Error("Failed to assign daemon.");
    return (await response.json()) as ProjectInfo;
  }

  async setEnabledWorkflowIds(
    projectId: string,
    workflowIds: string[],
  ): Promise<ProjectInfo> {
    const response = await fetch(
      this.api(
        `/v1/projects/${encodeURIComponent(projectId)}/enabled-workflows`,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowIds }),
      },
    );
    if (!response.ok) throw new Error("Failed to update enabled workflows.");
    return (await response.json()) as ProjectInfo;
  }
  async setSettings(
    projectId: string,
    input: { setupCommand: string | null },
  ): Promise<ProjectInfo> {
    const response = await fetch(
      this.api(`/v1/projects/${encodeURIComponent(projectId)}/settings`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) throw new Error("Failed to save project settings.");
    return (await response.json()) as ProjectInfo;
  }
}
