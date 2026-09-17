import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { pollForDeviceToken } from "../../../features/device-authorization/application/queries/pollForDeviceToken";
import type { DeviceAuthorizationStorePort } from "../../../features/device-authorization/domain/DeviceAuthorizationPort";
import {
  DeviceTokenApprovedSchema,
  DeviceTokenBodySchema,
  DeviceTokenPendingSchema,
} from "../../../features/device-authorization/adapters/inbound/dto/deviceAuthorizationDto";
import {
  PROBLEM_MEDIA_TYPE,
  ProblemDetailSchema,
  buildProblemDetail,
} from "../../../infrastructure/http/problemDetails";

const pollForDeviceTokenRoute = createRoute({
  method: "post",
  path: "/v1/device/token",
  request: { body: { content: { "application/json": { schema: DeviceTokenBodySchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: z.union([DeviceTokenApprovedSchema, DeviceTokenPendingSchema]) } },
      description: "Approved credentials or pending status.",
    },
    403: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Grant denied.",
    },
    410: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Grant expired.",
    },
    422: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Invalid token request.",
    },
    429: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Polling too fast.",
    },
  },
});

function tokenErrorStatus(code: string): 403 | 410 | 429 {
  if (code === "access_denied") return 403;
  if (code === "expired_token") return 410;
  return 429;
}

function tokenProblem(context: Context, status: 403 | 410 | 429, code: string, detail: string) {
  return context.json(
    buildProblemDetail({ status, code, detail, instance: context.req.path }),
    status,
    { "content-type": PROBLEM_MEDIA_TYPE },
  );
}

export function registerPollForDeviceTokenRoute(
  app: OpenAPIHono,
  dependencies: { store: DeviceAuthorizationStorePort },
): void {
  app.openapi(pollForDeviceTokenRoute, async (context) => {
    const result = await pollForDeviceToken(
      dependencies.store,
      context.req.valid("json").device_code,
    );
    if (result.ok) return context.json({ status: "approved" as const, daemonId: result.value.daemonId, authToken: result.value.authToken }, 200);
    if (result.error.code === "authorization_pending") return context.json({ status: "pending" as const }, 200);
    return tokenProblem(context, tokenErrorStatus(result.error.code), result.error.code, result.error.message);
  });
}
