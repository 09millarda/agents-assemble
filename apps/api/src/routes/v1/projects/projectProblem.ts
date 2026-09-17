import type { Context } from "hono";
import {
  PROBLEM_MEDIA_TYPE,
  buildProblemDetail,
} from "../../../infrastructure/http/problemDetails";

export function projectProblemStatus(code: string): 400 | 404 {
  return code === "PROJECT_NOT_FOUND" ? 404 : 400;
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
