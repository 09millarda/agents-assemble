import { z } from "zod";
import { MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT, isCursorValid } from "../../../../../infrastructure/http/pagination";

export const DaemonConfigurationSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  maxParallelHarnesses: z.number().int().min(1).max(10),
  location: z.string(),
  deviceLabel: z.string(),
  purpose: z.string(),
  ownerTeam: z.string(),
  tags: z.array(z.string().trim().min(1)),
  notes: z.string(),
});
export type DaemonConfigurationDto = z.infer<
  typeof DaemonConfigurationSchema
>;

export const DaemonConfigurationStateSchema = z.object({
  desired: DaemonConfigurationSchema,
  applied: DaemonConfigurationSchema.nullable(),
  revision: z.number().int().positive(),
  appliedRevision: z.number().int().positive().nullable(),
  status: z.enum(["pending", "applied", "failed"]),
  failureReason: z.string().nullable(),
});

const DaemonHarnessCapabilitySchema = z.object({
  harness: z.string(),
  version: z.string(),
  models: z.array(
    z.object({ model: z.string(), efforts: z.array(z.string()) }),
  ),
  questions: z.boolean(),
  permissions: z.boolean(),
  structuredOutput: z.boolean(),
});

export const DaemonRuntimeFactsSchema = z.object({
  machineName: z.string().min(1),
  operatingSystem: z.string(),
  architecture: z.string(),
  cpuCount: z.number().int().nonnegative(),
  memoryBytes: z.number().int().nonnegative(),
  daemonVersion: z.string(),
  harnessVersions: z.array(
    z.object({ harness: z.string(), version: z.string() }),
  ),
  capabilities: z.array(DaemonHarnessCapabilitySchema),
  lastSeenAt: z.string(),
});

export const DaemonTelemetrySchema = z.object({
  activeHarnesses: z.number().int().nonnegative(),
  queuedCommands: z.number().int().nonnegative(),
  desiredMaxParallelHarnesses: z.number().int().min(1).max(10),
  appliedMaxParallelHarnesses: z.number().int().min(1).max(10),
});

export const DaemonDetailsSchema = z.object({
  daemonId: z.string().min(1),
  machineName: z.string().trim().min(1),
  status: z.enum(["unknown", "online", "offline", "busy", "deregistered"]),
  configuration: DaemonConfigurationStateSchema,
  runtimeFacts: DaemonRuntimeFactsSchema.nullable(),
  telemetry: DaemonTelemetrySchema.nullable(),
});

export const DaemonParamsSchema = z.object({
  daemonId: z.string().min(1),
});

export const DaemonDtoSchema = z.object({
  daemonId: z.string().min(1),
  machineName: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  status: z.enum(["unknown", "online", "offline", "busy", "deregistered"]),
  maxParallelHarnesses: z.number().int().min(1).max(10),
  appliedMaxParallelHarnesses: z.number().int().min(1).max(10).nullable(),
  activeHarnesses: z.number().int().nonnegative(),
  queuedCommands: z.number().int().nonnegative(),
});
export type DaemonDto = z.infer<typeof DaemonDtoSchema>;

export const ListDaemonsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().refine(isCursorValid, { message: "Cursor is invalid." }).optional(),
});
export type ListDaemonsQuery = z.infer<typeof ListDaemonsQuerySchema>;

export const DaemonListResponseSchema = z.object({
  data: z.array(DaemonDtoSchema),
  pagination: z.object({
    nextCursor: z.string().nullable(),
    limit: z.number(),
  }),
});
export type DaemonListResponse = z.infer<typeof DaemonListResponseSchema>;

export const DeregisterDaemonParamsSchema = DaemonParamsSchema;
export type DeregisterDaemonParams = z.infer<typeof DeregisterDaemonParamsSchema>;

export const DeregisterDaemonResponseSchema = z.object({
  daemonId: z.string().min(1),
  status: z.literal("deregistered"),
});
export type DeregisterDaemonResponse = z.infer<typeof DeregisterDaemonResponseSchema>;
