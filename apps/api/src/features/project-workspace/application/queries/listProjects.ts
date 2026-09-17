import { compareProjectNames } from "@factory/shared-domain";
import { DEFAULT_PAGE_LIMIT, paginateById } from "../../../../infrastructure/http/pagination";
import type { Page } from "../../../../infrastructure/http/pagination";
import type { ProjectInfo } from "@factory/shared-domain";
import type { ProjectRegistryPort } from "../../domain/ProjectWorkspacePort";

export async function listProjects(
  registry: ProjectRegistryPort,
  input: { limit?: number; cursor?: string | null } = {}
): Promise<Page<ProjectInfo>> {
  const all = await registry.listProjects();
  const ordered = [...all].sort((a, b) => compareProjectNames(a.projectId, b.projectId));
  return paginateById(ordered, (project) => project.projectId, input.limit ?? DEFAULT_PAGE_LIMIT, input.cursor ?? null);
}
