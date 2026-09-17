import type { ProjectInfo } from "@factory/shared-domain";
import type { WorkflowDefinition } from "@factory/workflow";

export interface ProjectRegistryPort {
  createProject(input: { name: string; absolutePath: string }): Promise<ProjectInfo>;
  listProjects(): Promise<ProjectInfo[]>;
  findProject(projectId: string): Promise<ProjectInfo | null>;
  setProjectName(projectId: string, name: string): Promise<ProjectInfo | null>;
  assignDaemon(projectId: string, daemonId: string): Promise<ProjectInfo | null>;
  setEnabledWorkflowIds(projectId: string, workflowIds: string[]): Promise<ProjectInfo | null>;
  setSetupCommand(projectId: string, setupCommand: string | null): Promise<ProjectInfo | null>;
  markGitStatus(projectId: string, gitStatus: ProjectInfo["gitStatus"], blockedReason: string | null): Promise<void>;
}

export interface WorkflowAvailabilityPort {
  findDefinition(workflowId: string): Promise<WorkflowDefinition | null>;
}
