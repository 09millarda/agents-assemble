import { createHash } from "node:crypto";
import { z } from "zod";

export const PROTOCOL_VERSION = "aa-runner/1" as const;
export const PINNED_CODEX_VERSION = "0.153.4";
export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime();
export const scopeSchema = z.strictObject({
  deploymentId: id,
  organizationId: id,
  runnerId: id,
  journalId: id,
  runId: id,
  occurrenceId: id,
  attemptId: id,
  invocationId: id,
  assignmentId: id,
  generation: z.int().positive(),
  admissionId: id,
  inputDigest: digest,
});
export type Scope = z.infer<typeof scopeSchema>;
export const runtimeSchema = z.strictObject({
  profileId: id,
  revision: digest,
  model: z.string().min(1).max(100),
  effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]),
  sandbox: z.enum(["read-only", "workspace-write"]),
  trustedRunner: z.literal(true),
  codexVersion: z.literal(PINNED_CODEX_VERSION),
});
export const environmentSchema = z.strictObject({
  profileId: id,
  revision: digest,
  variables: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(8192)),
  secretBindings: z
    .array(z.strictObject({ name: z.string().regex(/^[A-Z_][A-Z0-9_]*$/), logicalName: id }))
    .max(32),
});
export const artifactRefSchema = z.strictObject({
  id: z.string(),
  revisionId: z.string(),
  digest,
  mediaType: z.string(),
});
export const checkpointRefSchema = z.strictObject({
  id: z.string(),
  repositoryId: z.string(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  digest,
});
export const repositorySchema = z.strictObject({
  repositoryId: id,
  url: z.string().min(1).max(2048),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
});
export const startPayloadSchema = z.strictObject({
  prompt: z.string().min(1).max(131072),
  repository: repositorySchema,
  runtime: runtimeSchema,
  environment: environmentSchema,
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  checkpoint: checkpointRefSchema.optional(),
});
export const deterministicPayloadSchema = z.strictObject({
  repository: repositorySchema,
  runtime: runtimeSchema,
  environment: environmentSchema,
  checkpoint: checkpointRefSchema,
  spec: artifactRefSchema.optional(),
  commands: z
    .array(z.array(z.string().min(1).max(8192)).min(1).max(64))
    .min(1)
    .max(32)
    .optional(),
  timeoutSeconds: z.int().min(1).max(3600).default(300),
});
const base = { commandId: id, scope: scopeSchema, expiresAt: timestamp, payloadDigest: digest };
export const nativeRequestIdSchema = z.union([z.string().min(1).max(160), z.int()]);
export const nativeQuestionParamsSchema = z.strictObject({
  threadId: id,
  turnId: id,
  itemId: id,
  questions: z
    .array(
      z.strictObject({
        id,
        header: z.string().max(200),
        question: z.string().min(1).max(8000),
        isOther: z.boolean(),
        isSecret: z.literal(false),
        options: z
          .array(
            z.strictObject({
              label: z.string().min(1).max(1000),
              description: z.string().max(2000),
            }),
          )
          .min(1)
          .max(20)
          .nullable(),
      }),
    )
    .min(1)
    .max(10)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      "duplicate_question_id",
    ),
  isBlocking: z.boolean(),
  autoResolutionMs: z.int().positive().max(3600000).nullable(),
});
export const nativeQuestionSchema = nativeQuestionParamsSchema.extend({
  requestId: nativeRequestIdSchema,
  expiresAt: timestamp,
});
export const nativeAnswersSchema = z.strictObject({
  answers: z.record(
    id,
    z.strictObject({ answers: z.array(z.string().min(1).max(16000)).min(1).max(1) }),
  ),
});
export function questionResponseSchema(question: z.infer<typeof nativeQuestionParamsSchema>) {
  return {
    type: "object",
    properties: {
      answers: {
        type: "object",
        properties: Object.fromEntries(
          question.questions.map((item) => [
            item.id,
            {
              type: "object",
              properties: {
                answers: {
                  type: "array",
                  minItems: 1,
                  maxItems: 1,
                  items: {
                    type: "string",
                    minLength: 1,
                    maxLength: 16000,
                    ...(item.options && !item.isOther
                      ? { enum: item.options.map((option) => option.label) }
                      : {}),
                  },
                },
              },
              required: ["answers"],
              additionalProperties: false,
            },
          ]),
        ),
        required: question.questions.map((item) => item.id),
        additionalProperties: false,
      },
    },
    required: ["answers"],
    additionalProperties: false,
  };
}
export function validateNativeAnswers(
  question: z.infer<typeof nativeQuestionParamsSchema>,
  value: unknown,
) {
  const answer = nativeAnswersSchema.parse(value);
  if (Object.keys(answer.answers).length !== question.questions.length)
    throw new Error("question_answer_keys_mismatch");
  for (const item of question.questions) {
    const values = answer.answers[item.id]?.answers;
    if (
      !values ||
      (item.options &&
        !item.isOther &&
        values.some((value) => !item.options?.some((option) => option.label === value)))
    )
      throw new Error("question_answer_choice_mismatch");
  }
  return answer;
}
export const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("start"), payload: startPayloadSchema }),
  z.strictObject({ ...base, kind: z.literal("prepare"), payload: deterministicPayloadSchema }),
  z.strictObject({ ...base, kind: z.literal("check"), payload: deterministicPayloadSchema }),
  z.strictObject({
    ...base,
    kind: z.literal("answer"),
    payload: z.strictObject({
      inputId: id,
      questionId: id,
      requestId: nativeRequestIdSchema,
      threadId: id,
      turnId: id,
      itemId: id,
      questionDigest: digest,
      response: nativeAnswersSchema,
      actorId: id,
    }),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("steer"),
    payload: z.strictObject({
      inputId: id,
      sequence: z.int().positive(),
      threadId: id,
      turnId: id,
      text: z.string().min(1).max(16384),
      actorId: id,
    }),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("interrupt"),
    payload: z.strictObject({
      inputId: id,
      threadId: id,
      turnId: id,
      reason: z.string().min(1).max(1024),
    }),
  }),
]);
export type RunnerCommand = z.infer<typeof commandSchema>;
export type StartCommand = Extract<RunnerCommand, { kind: "start" }>;
export type WorkCommand = Extract<RunnerCommand, { kind: "start" | "prepare" | "check" }>;
export const launchAuthorizationRequestSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  commandId: id,
  scope: scopeSchema,
  payloadDigest: digest,
});
export const launchAuthorizationResponseSchema = z.strictObject({
  authorized: z.literal(true),
  commandId: id,
  scope: scopeSchema,
  payloadDigest: digest,
  expiresAt: timestamp,
  serverTime: timestamp,
});
export const artifactUploadSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  operationId: id,
  scope: scopeSchema,
  mediaType: z.enum(["text/markdown", "text/plain", "application/json"]),
  content: z.string().max(262144),
});
export const artifactReadSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  operationId: id,
  scope: scopeSchema,
  reference: artifactRefSchema,
});
export const artifactReadResponseSchema = z.strictObject({
  reference: artifactRefSchema,
  content: z.string().max(131072),
});
export const capabilitySchema = z.strictObject({
  platform: z.string().max(100),
  codexVersion: z.string().max(100),
  nativeLoginReady: z.boolean(),
  nativeAuthentication: z.enum([
    "chatgpt",
    "reauthentication_required",
    "unsupported",
    "unavailable",
  ]),
  enforcement: z.literal("trusted_runner"),
  writerCoverage: z.literal("incomplete"),
  automaticTakeover: z.literal(false),
  protocolVersion: z.literal(PROTOCOL_VERSION),
});
export const receiptSchema = z.strictObject({
  receiptId: id,
  commandId: id,
  scope: scopeSchema,
  sequence: z.int().positive(),
  status: z.enum([
    "observation",
    "received",
    "running",
    "delivered",
    "interrupted",
    "completed",
    "failed",
    "rejected",
    "outcome_unknown",
    "output",
    "gap",
    "question",
  ]),
  details: z.record(z.string(), z.unknown()),
  createdAt: timestamp,
});
export type RunnerReceipt = z.infer<typeof receiptSchema>;
export const reconcileRequestSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  runnerId: id,
  journalId: id,
  sequence: z.int().nonnegative(),
  capabilities: capabilitySchema,
  receipts: z.array(receiptSchema).max(200),
});
export const reconcileResponseSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  serverTime: timestamp,
  revoked: z.boolean(),
  commands: z.array(commandSchema).max(100),
  acceptedReceiptIds: z.array(id).max(200),
});
export const enrollmentRequestSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  operationId: id,
  enrollmentToken: z.string().min(20).max(1024),
  csrPem: z.string().max(8192),
  journalId: id,
});
export const enrollmentResponseSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  runnerId: id,
  organizationId: id,
  deploymentId: id,
  credentialGeneration: z.int().positive(),
  certificatePem: z.string().max(16384),
  caPem: z.string().max(16384),
  expiresAt: timestamp,
});

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  throw new Error("unsupported_canonical_value");
}
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
export function payloadDigest(payload: unknown): string {
  return sha256(canonicalJson(payload));
}
export function authorityDigest(command: RunnerCommand): string {
  const { payload: _, ...metadata } = command;
  const bytes = canonicalJson(metadata);
  if (!/^[\x20-\x7e]*$/.test(bytes)) throw new Error("non_ascii_authority_metadata");
  return sha256(`agents-assemble/runner-authority/v1\0${bytes}`);
}
export function verifyCommand(value: unknown): RunnerCommand {
  const command = commandSchema.parse(value);
  if (payloadDigest(command.payload) !== command.payloadDigest)
    throw new Error("payload_digest_mismatch");
  authorityDigest(command);
  return command;
}
