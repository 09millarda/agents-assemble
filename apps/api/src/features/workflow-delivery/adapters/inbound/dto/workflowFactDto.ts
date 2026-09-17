import { z } from "zod";
export const WorkflowFactSchema = z.object({
  factId: z.string().min(1),
  commandId: z.string().min(1),
  executionId: z.string().min(1),
  runId: z.string().min(1),
  type: z.enum([
    "received",
    "progress",
    "question",
    "permission",
    "completed",
    "failed",
    "recovery_required",
    "cancelled",
  ]),
  code: z.string().optional(),
  message: z.string().optional(),
  sessionId: z.string().optional(),
  harnessTurnId: z.string().optional(),
  interactionId: z.string().optional(),
  permissionRequest: z.unknown().optional(),
  completion: z
    .object({
      outcome: z.string(),
      outputs: z.array(
        z.object({ documentId: z.string(), content: z.string() }),
      ).optional(),
    })
    .optional(),
  workspaceResult: z
    .object({
      worktreePath: z.string(),
      branch: z.string(),
      pinnedCommit: z.string(),
      treeHash: z.string().optional(),
      diff: z.string().optional(),
      setupLog: z.string().optional(),
      repository: z.string().optional(),
      pushRemote: z.string().optional(),
      prBase: z.string().optional(),
    })
    .optional(),
  publication: z
    .object({ url: z.url(), number: z.number().optional() })
    .optional(),
});
