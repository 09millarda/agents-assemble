import { z } from "zod";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, isCursorValid } from "../../../../../infrastructure/http/pagination";

export const ProjectDtoSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(100),
  absolutePath: z.string().startsWith("/"),
  daemonId: z.string().nullable(),
  gitStatus: z.enum(["unknown", "valid", "missing-path", "not-a-repo", "git-unavailable"]),
  blockedReason: z.string().nullable(),
  setupCommand: z.string().nullable().optional(),
  enabledWorkflowIds: z.array(z.string().min(1)),
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

export const CreateProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  absolutePath: z.string().startsWith("/", { message: "Project path must be absolute." }),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const ProjectNameBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type ProjectNameBody = z.infer<typeof ProjectNameBodySchema>;

export const AssignDaemonBodySchema = z.object({
  daemonId: z.string().min(1),
});
export type AssignDaemonBody = z.infer<typeof AssignDaemonBodySchema>;

export const SetEnabledWorkflowIdsBodySchema = z.object({
  workflowIds: z.array(z.string().min(1).max(64)).max(100),
});
export type SetEnabledWorkflowIdsBody = z.infer<typeof SetEnabledWorkflowIdsBodySchema>;

export const ListProjectsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().refine(isCursorValid, { message: "Cursor is invalid." }).optional(),
});

export const ProjectListResponseSchema = z.object({
  data: z.array(ProjectDtoSchema),
  pagination: z.object({ nextCursor: z.string().nullable(), limit: z.number() }),
});

export const ProjectSettingsBodySchema = z.object({ setupCommand: z.string().max(10000).nullable() });
