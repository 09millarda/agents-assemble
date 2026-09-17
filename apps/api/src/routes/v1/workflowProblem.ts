import type { Context } from "hono";
import type { z } from "zod";
import {
  PROBLEM_MEDIA_TYPE,
  ProblemDetailSchema,
  buildProblemDetail,
} from "../../infrastructure/http/problemDetails";

export function workflowProblemStatus(code: string): 400 | 401 | 404 | 409 | 422 {
  if (code === "RECIPIENT_UNAUTHORIZED") return 401;
  if (code.endsWith("NOT_FOUND")) return 404;
  if (code === "INVALID_WORKFLOW" || code === "IDENTITY_MISMATCH") return 422;
  return 409;
}

export function workflowProblemResponse(
  context: Context,
  code: string,
  detail: string,
) {
  const status = workflowProblemStatus(code);
  return context.json(
    buildProblemDetail({ status, code, detail, instance: context.req.path }),
    status,
    { "content-type": PROBLEM_MEDIA_TYPE },
  );
}

export function workflowResponseSchemas<Response extends z.ZodType>(response: Response) {
  const problem = {
    description: "Problem Details.",
    content: { "application/problem+json": { schema: ProblemDetailSchema } },
  };
  return {
    200: {
      description: "Resource or accepted command.",
      content: { "application/json": { schema: response } },
    },
    201: {
      description: "Created resource.",
      content: { "application/json": { schema: response } },
    },
    400: problem,
    401: problem,
    404: problem,
    409: problem,
    422: problem,
  };
}
