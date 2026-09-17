import { randomBytes } from "node:crypto";
import { describeProjectBlockedReason } from "@factory/shared-domain";
import type { ProjectInfo } from "@factory/shared-domain";
import { projectEnabledWorkflows, projects, eq } from "@factory/db";
import type { Database } from "@factory/db";
import type { ProjectRegistryPort } from "../domain/ProjectWorkspacePort";

export interface ProjectRow {
  projectId: string;
  name: string;
  absolutePath: string;
  daemonId: string | null;
  gitStatus: string | null;
  blockedReason: string | null;
  setupCommand?: string | null;
}

export function toProjectInfo(row: ProjectRow, enabledWorkflowIds: string[] = []): ProjectInfo {
  const gitStatus = (row.gitStatus ?? "unknown") as ProjectInfo["gitStatus"];
  return {
    projectId: row.projectId,
    name: row.name,
    absolutePath: row.absolutePath,
    daemonId: row.daemonId,
    gitStatus,
    blockedReason: row.blockedReason ?? describeProjectBlockedReason(gitStatus),
    enabledWorkflowIds: [...enabledWorkflowIds].sort(),
    setupCommand: row.setupCommand ?? null,
  };
}

export class DrizzleProjectRegistryAdapter implements ProjectRegistryPort {
  constructor(private readonly database: Database) {}

  private async readEnabledWorkflowIds(projectId: string): Promise<string[]> {
    const rows = await this.database
      .select({ workflowId: projectEnabledWorkflows.workflowId })
      .from(projectEnabledWorkflows)
      .where(eq(projectEnabledWorkflows.projectId, projectId));
    return rows.map((row) => row.workflowId).sort();
  }

  async createProject(input: { name: string; absolutePath: string }): Promise<ProjectInfo> {
    const projectId = randomBytes(8).toString("hex");
    await this.database.insert(projects).values({ projectId, name: input.name, absolutePath: input.absolutePath, gitStatus: "unknown", blockedReason: null });
    return { projectId, name: input.name, absolutePath: input.absolutePath, daemonId: null, gitStatus: "unknown", blockedReason: null, enabledWorkflowIds: [] };
  }

  async listProjects(): Promise<ProjectInfo[]> {
    const rows = await this.database.select().from(projects);
    const enabled = await this.database.select().from(projectEnabledWorkflows);
    const byProject = new Map<string, string[]>();
    for (const row of enabled) {
      const next = byProject.get(row.projectId) ?? [];
      next.push(row.workflowId);
      byProject.set(row.projectId, next);
    }
    return rows.map((row) => toProjectInfo(row, byProject.get(row.projectId) ?? []));
  }

  async findProject(projectId: string): Promise<ProjectInfo | null> {
    const rows = await this.database.select().from(projects).where(eq(projects.projectId, projectId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return toProjectInfo(row, await this.readEnabledWorkflowIds(projectId));
  }

  async setProjectName(
    projectId: string,
    name: string,
  ): Promise<ProjectInfo | null> {
    await this.database
      .update(projects)
      .set({ name })
      .where(eq(projects.projectId, projectId));
    return this.findProject(projectId);
  }

  async assignDaemon(projectId: string, daemonId: string): Promise<ProjectInfo | null> {
    await this.database.update(projects).set({ daemonId }).where(eq(projects.projectId, projectId));
    return this.findProject(projectId);
  }

  async setEnabledWorkflowIds(projectId: string, workflowIds: string[]): Promise<ProjectInfo | null> {
    const existing = await this.findProject(projectId);
    if (!existing) return null;
    await this.database.delete(projectEnabledWorkflows).where(eq(projectEnabledWorkflows.projectId, projectId));
    for (const workflowId of [...new Set(workflowIds)].sort()) {
      await this.database.insert(projectEnabledWorkflows).values({ projectId, workflowId });
    }
    return this.findProject(projectId);
  }

  async setSetupCommand(projectId: string, setupCommand: string | null): Promise<ProjectInfo | null> {
    await this.database.update(projects).set({ setupCommand }).where(eq(projects.projectId, projectId));
    return this.findProject(projectId);
  }

  async markGitStatus(projectId: string, gitStatus: ProjectInfo["gitStatus"], blockedReason: string | null): Promise<void> {
    await this.database.update(projects).set({ gitStatus, blockedReason }).where(eq(projects.projectId, projectId));
  }
}
