export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  instance: string;
}

const STATUS_TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  410: "Gone",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
};

export const PROBLEM_MEDIA_TYPE = "application/problem+json";

export function buildProblemDetail(input: {
  status: number;
  code: string;
  detail: string;
  instance: string;
  title?: string;
  type?: string;
}): ProblemDetail {
  return {
    type: input.type ?? `https://factory.local/problems/${input.code.toLowerCase().replace(/_/g, "-")}`,
    title: input.title ?? STATUS_TITLES[input.status] ?? "Error",
    status: input.status,
    detail: input.detail,
    code: input.code,
    instance: input.instance,
  };
}
import { z } from "zod";

export const ProblemDetailSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
  code: z.string(),
  instance: z.string(),
});
