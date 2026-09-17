import type { Hook } from "@hono/zod-openapi";
import { PROBLEM_MEDIA_TYPE, buildProblemDetail } from "./problemDetails";

export const validationHook: Hook<any, any, any, any> = (result, context) => {
  if (result.success) return;
  return context.json(
    buildProblemDetail({
      status: 422,
      code: "VALIDATION_FAILED",
      detail: "Request validation failed.",
      instance: context.req.path,
    }),
    422,
    { "content-type": PROBLEM_MEDIA_TYPE },
  );
};
