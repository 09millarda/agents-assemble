import { z } from "zod";
import { jsonValue } from "./json.ts";

export const Id = z.string().uuid();
export const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const OperationId = z.string().min(1).max(160);
export const Role = z.enum(["member", "admin", "publisher", "moderator"]);
export const ActorSchema = z
  .object({
    userId: Id,
    organizationId: Id,
    role: Role,
    authorityGeneration: z.number().int().positive(),
  })
  .strict();
export type Actor = z.infer<typeof ActorSchema>;
export const ErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
    retry: z.enum(["never", "same_operation", "reconcile"]),
    currentVersion: z.number().int().optional(),
  })
  .strict();
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly retry: "never" | "same_operation" | "reconcile" = "never",
    public readonly currentVersion?: number,
  ) {
    super(message);
  }
}
export const ContextName = z.enum([
  "access",
  "projects",
  "catalog",
  "execution",
  "fleet",
  "knowledge",
  "human",
  "integrations",
  "environments",
  "community",
]);
export type ContextName = z.infer<typeof ContextName>;
export const MessageSchema = z
  .object({
    id: Id,
    organizationId: Id,
    source: ContextName,
    type: z.string().min(1).max(120),
    schemaVersion: z.literal(1),
    aggregateId: Id,
    aggregateVersion: z.number().int().positive(),
    sequence: z.number().int().positive(),
    causationId: z.string(),
    correlationId: z.string(),
    occurredAt: z.string().datetime(),
    payload: jsonValue,
  })
  .strict();
export type Message = z.infer<typeof MessageSchema>;
export const VersionCommand = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const PageQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });
