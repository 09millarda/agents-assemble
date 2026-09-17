import type { ProjectInfo } from "@factory/shared-domain";

export interface ProjectWorkspacePort {
  listProjects(): Promise<ProjectInfo[]>;
  createProject(input: {
    name: string;
    absolutePath: string;
  }): Promise<ProjectInfo>;
  setProjectName(projectId: string, name: string): Promise<ProjectInfo>;
  assignDaemon(projectId: string, daemonId: string): Promise<ProjectInfo>;
  setEnabledWorkflowIds(
    projectId: string,
    workflowIds: string[],
  ): Promise<ProjectInfo>;
  setSettings(
    projectId: string,
    input: { setupCommand: string | null },
  ): Promise<ProjectInfo>;
}
