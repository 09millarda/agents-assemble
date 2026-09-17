import { z } from "zod";
import { MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT, isCursorValid } from "../../../../../infrastructure/http/pagination";

export const DaemonDtoSchema = z.object({
  daemonId: z.string().min(1),
  machineName: z.string().trim().min(1),
  status: z.enum(["unknown", "online", "offline", "busy", "deregistered"]),
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

export const DeregisterDaemonParamsSchema = z.object({
  daemonId: z.string().min(1),
});
export type DeregisterDaemonParams = z.infer<typeof DeregisterDaemonParamsSchema>;

export const DeregisterDaemonResponseSchema = z.object({
  daemonId: z.string().min(1),
  status: z.literal("deregistered"),
});
export type DeregisterDaemonResponse = z.infer<typeof DeregisterDaemonResponseSchema>;
