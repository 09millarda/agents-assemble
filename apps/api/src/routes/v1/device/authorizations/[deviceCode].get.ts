import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { getDeviceAuthorizationStatus } from "../../../../features/device-authorization/application/queries/getDeviceAuthorizationStatus";
import type { DeviceAuthorizationStorePort } from "../../../../features/device-authorization/domain/DeviceAuthorizationPort";
import { DeviceAuthorizationStatusSchema } from "../../../../features/device-authorization/adapters/inbound/dto/deviceAuthorizationDto";
import {
  PROBLEM_MEDIA_TYPE,
  ProblemDetailSchema,
  buildProblemDetail,
} from "../../../../infrastructure/http/problemDetails";

const readDeviceAuthorizationRoute = createRoute({
  method: "get",
  path: "/v1/device/authorizations/{deviceCode}",
  request: { params: z.object({ deviceCode: z.string().min(1) }) },
  responses: {
    200: {
      content: { "application/json": { schema: DeviceAuthorizationStatusSchema } },
      description: "Current grant status.",
    },
    404: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Unknown device code.",
    },
  },
});

function unknownGrant(context: Context, code: string, detail: string) {
  return context.json(
    buildProblemDetail({ status: 404, code, detail, instance: context.req.path }),
    404,
    { "content-type": PROBLEM_MEDIA_TYPE },
  );
}

export function registerReadDeviceAuthorizationRoute(
  app: OpenAPIHono,
  dependencies: { store: DeviceAuthorizationStorePort },
): void {
  app.openapi(readDeviceAuthorizationRoute, async (context) => {
    const result = await getDeviceAuthorizationStatus(
      dependencies.store,
      context.req.valid("param").deviceCode,
    );
    if (!result.ok) return unknownGrant(context, result.error.code, result.error.message);
    return context.json({
      deviceCode: result.value.deviceCode,
      status: result.value.status,
      expiresAt: new Date(result.value.expiresAtMs).toISOString(),
    }, 200);
  });
}
