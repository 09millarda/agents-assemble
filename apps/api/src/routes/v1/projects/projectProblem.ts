import type { Context } from "hono";
import {
  PROBLEM_MEDIA_TYPE,
  buildProblemDetail,
} from "../../../infrastructure/http/problemDetails";

export function projectProblemStatus(code: string): 400 | 404 | 409 {
  if (code === "PROJECT_NOT_FOUND" || code === "WORKFLOW_NOT_FOUND") return 404;
  if (code === "WORKFLOW_NOT_PUBLISHED") return 409;
  return 400;
}

export function projectProblemResponse(
  context: Context,
  code: string,
  detail: string,
) {
  const status = projectProblemStatus(code);
  return context.json(
    buildProblemDetail({ status, code, detail, instance: context.req.path }),
    status,
    { "content-type": PROBLEM_MEDIA_TYPE },
  );
}
