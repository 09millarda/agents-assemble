import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { approveDeviceAuthorization } from "../../../features/device-authorization/application/commands/approveDeviceAuthorization";
import type { DaemonCredentialIssuerPort, DeviceAuthorizationStorePort } from "../../../features/device-authorization/domain/DeviceAuthorizationPort";
import {
  ApproveDeviceAuthorizationBodySchema,
  ApproveDeviceAuthorizationResponseSchema,
} from "../../../features/device-authorization/adapters/inbound/dto/deviceAuthorizationDto";
import {
  PROBLEM_MEDIA_TYPE,
  ProblemDetailSchema,
  buildProblemDetail,
} from "../../../infrastructure/http/problemDetails";

const approveDeviceAuthorizationRoute = createRoute({
  method: "post",
  path: "/v1/device/approve",
  request: { body: { content: { "application/json": { schema: ApproveDeviceAuthorizationBodySchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: ApproveDeviceAuthorizationResponseSchema } },
      description: "Grant approved.",
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

export function registerApproveDeviceAuthorizationRoute(
  app: OpenAPIHono,
  dependencies: {
    store: DeviceAuthorizationStorePort;
    issuer: DaemonCredentialIssuerPort;
  },
): void {
  app.openapi(approveDeviceAuthorizationRoute, async (context) => {
    const result = await approveDeviceAuthorization(
      dependencies.store,
      dependencies.issuer,
      context.req.valid("json").user_code,
    );
    if (!result.ok) return unusableCode(context, result.error.code, result.error.message);
    return context.json(result.value, 200);
  });
}
