import { z } from "zod";
import { isCursorValid } from "../../../../../infrastructure/http/pagination";
const identity = z.string().min(1).max(160);
const derivedIdentity = z.string().min(1).max(512);
export const ExecutionSettingsSchema = z.object({
  kind: z.literal("agent"),
  harness: z.literal("codex"),
  model: z.string().min(1),
  effort: z.string().min(1),
});
export const ActivitySchema = z.object({
  activityId: identity,
  name: z.string().min(1),
  description: z.string(),
  instructions: z.string(),
  execution: ExecutionSettingsSchema,
  humanInput: z.enum(["off", "approval", "input"]),
  outcomes: z
    .array(
      z.object({
        name: identity,
        handoff: z.object({
          targetActivityId: identity.nullable(),
          continuation: z.enum(["automatic", "approval"]),
        }),
      }),
    )
    .min(1),
});
export const WorkflowDefinitionSchema = z.object({
  workflowId: identity,
  name: z.string().min(1),
  description: z.string(),
  activities: z.array(ActivitySchema).max(100),
  positions: z.record(identity, z.object({ x: z.number(), y: z.number() })),
});
export const WorkspaceSchema = z.object({
  projectPath: z.string(),
  requirePublication: z.boolean().optional(),
  branch: z.string().optional(),
  pinnedCommit: z.string().optional(),
  setupCommand: z.string().optional(),
  repository: z.string().optional(),
  pushRemote: z.string().optional(),
  prBase: z.string().optional(),
});
export const WorkspaceResultSchema = z.object({
  worktreePath: z.string(),
  branch: z.string(),
  pinnedCommit: z.string(),
  treeHash: z.string().optional(),
  diff: z.string().optional(),
  setupLog: z.string().optional(),
  repository: z.string().optional(),
  pushRemote: z.string().optional(),
  prBase: z.string().optional(),
});
export const DocumentRevisionSchema = z.object({
  revisionId: derivedIdentity,
  runId: identity,
  documentId: identity,
  name: z.string(),
  revision: z.number().int().positive(),
  executionId: derivedIdentity,
  activityId: identity,
  content: z.string(),
  consumedRevisionIds: z.array(derivedIdentity),
  createdAt: z.iso.datetime(),
});
export const HumanInteractionSchema = z.object({
  interactionId: derivedIdentity,
  executionId: derivedIdentity,
  kind: z.enum([
    "question",
    "permission",
    "approval",
    "loop-exhaustion",
    "recovery",
  ]),
  prompt: z.string(),
  outputRevisionIds: z.array(derivedIdentity),
  targetActivityId: identity.nullable(),
  loopId: identity.optional(),
  reviewedTreeHash: z.string().optional(),
  permissionRequest: z.unknown().optional(),
});
export const TranscriptEntrySchema = z.object({
  entryId: derivedIdentity,
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  createdAt: z.iso.datetime(),
});
export const ActivityExecutionSchema = z.object({
  executionId: derivedIdentity,
  activityId: identity,
  activity: ActivitySchema,
  status: z.enum([
    "running",
    "awaiting-human",
    "completed",
    "failed",
    "cancelled",
  ]),
  inputRevisionIds: z.array(derivedIdentity),
  outputRevisionIds: z.array(derivedIdentity),
  sessionId: z.string().nullable(),
  transcript: z.array(TranscriptEntrySchema),
  dispatchSequence: z.number().int(),
  harnessTurnIds: z.array(z.string()),
  recoveryAttempt: z.number().int(),
  commandId: derivedIdentity,
  outcome: z.string().nullable(),
  error: z.string().nullable(),
});
export const WorkflowRunSchema = z.object({
  runId: identity,
  name: z.string(),
  projectId: identity,
  workflowId: identity,
  daemonId: identity,
  recipientId: identity.nullable(),
  snapshot: WorkflowDefinitionSchema,
  workspace: WorkspaceSchema,
  workspaceResult: WorkspaceResultSchema.nullable(),
  kickoffPrompt: z.string().nullable(),
  status: z.enum([
    "queued",
    "running",
    "awaiting-human",
    "recovery-required",
    "completed",
    "cancelled",
    "failed",
  ]),
  executions: z.array(ActivityExecutionSchema),
  documents: z.array(DocumentRevisionSchema),
  interaction: HumanInteractionSchema.nullable(),
  loopPasses: z.record(z.string(), z.number()),
  loopLimits: z.record(z.string(), z.number()),
  processedMessageIds: z.array(derivedIdentity),
  approvedTreeHash: z.string().nullable(),
  acceptedFindings: z.boolean(),
  acceptedFindingRevisionIds: z.array(derivedIdentity),
  publication: z
    .object({ url: z.url(), number: z.number().optional() })
    .nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const StartWorkflowRunSchema = z.object({
  requestId: identity,
  workflowId: identity,
  projectId: identity,
  kickoffPrompt: z.string().optional(),
  branch: z.string().optional(),
  recipientId: identity.optional(),
  managementToken: z.string().optional(),
});
export const HumanResponseSchema = z.object({
  messageId: identity,
  interactionId: derivedIdentity.optional(),
  action: z.enum([
    "answer",
    "approve",
    "request-changes",
    "extend-loop",
    "accept-findings",
    "retry",
    "cancel",
    "allow-permission",
    "deny-permission",
  ]),
  answer: z.string().optional(),
  additionalPasses: z.number().int().positive().max(100).optional(),
});
export const BrowserRecipientSchema = z.object({
  recipientId: identity,
  active: z.boolean(),
  deliveryStatus: z.string(),
  lastDeliveryError: z.string().nullable().optional(),
  vapidPublicKey: z.string().nullable(),
});
export const NewBrowserRecipientSchema = BrowserRecipientSchema.extend({
  managementToken: z.string(),
});
export const SubscriptionBodySchema = z.object({
  managementToken: z.string().min(1),
  subscription: z
    .object({
      endpoint: z.url().startsWith("https://"),
      expirationTime: z.number().nullable().optional(),
      keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
    })
    .nullable(),
});
export const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().refine(isCursorValid).optional(),
  projectId: identity.optional(),
});
export function collectionSchema(item: z.ZodType) {
  return z.object({
    data: z.array(item),
    pagination: z.object({
      nextCursor: z.string().nullable(),
      limit: z.number(),
    }),
  });
}
export const EmptyRequestSchema = z.object({});
export const AcceptedMessageSchema = z.object({
  accepted: z.literal(true),
  messageId: z.string(),
});
export const DeletedWorkflowSchema = z.object({
  deleted: z.literal(true),
});
export const WorkflowNotificationSchema = z.object({
  notificationId: derivedIdentity,
  runId: identity,
  recipientId: identity.nullable(),
  kind: z.enum(["question", "approval", "recovery", "result"]),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  deliveryStatus: z.string(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
