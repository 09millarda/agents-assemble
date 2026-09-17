import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { denyDeviceAuthorization } from "../../../features/device-authorization/application/commands/denyDeviceAuthorization";
import type { DeviceAuthorizationStorePort } from "../../../features/device-authorization/domain/DeviceAuthorizationPort";
import {
  DenyDeviceAuthorizationBodySchema,
  DenyDeviceAuthorizationResponseSchema,
} from "../../../features/device-authorization/adapters/inbound/dto/deviceAuthorizationDto";
import {
  PROBLEM_MEDIA_TYPE,
  ProblemDetailSchema,
  buildProblemDetail,
} from "../../../infrastructure/http/problemDetails";

const denyDeviceAuthorizationRoute = createRoute({
  method: "post",
  path: "/v1/device/deny",
  request: { body: { content: { "application/json": { schema: DenyDeviceAuthorizationBodySchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: DenyDeviceAuthorizationResponseSchema } },
      description: "Grant denied.",
    },
    400: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Unknown or unusable user code.",
    },
    422: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Malformed user code.",
    },
  },
});

function unusableCode(context: Context, code: string, detail: string) {
  return context.json(
    buildProblemDetail({ status: 400, code, detail, instance: context.req.path }),
    400,
    { "content-type": PROBLEM_MEDIA_TYPE },
  );
}

export function registerDenyDeviceAuthorizationRoute(
  app: OpenAPIHono,
  dependencies: { store: DeviceAuthorizationStorePort },
): void {
  app.openapi(denyDeviceAuthorizationRoute, async (context) => {
    const result = await denyDeviceAuthorization(
      dependencies.store,
      context.req.valid("json").user_code,
    );
    if (!result.ok) return unusableCode(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  });
}
