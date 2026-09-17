import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { requestDeviceAuthorization } from "../../../../features/device-authorization/application/commands/requestDeviceAuthorization";
import type { DaemonCredentialIssuerPort, DeviceAuthorizationStorePort } from "../../../../features/device-authorization/domain/DeviceAuthorizationPort";
import {
  DeviceAuthorizationResponseSchema,
  RequestDeviceAuthorizationBodySchema,
} from "../../../../features/device-authorization/adapters/inbound/dto/deviceAuthorizationDto";
import { ProblemDetailSchema } from "../../../../infrastructure/http/problemDetails";

const requestDeviceAuthorizationRoute = createRoute({
  method: "post",
  path: "/v1/device/authorizations",
  request: { body: { content: { "application/json": { schema: RequestDeviceAuthorizationBodySchema } } } },
  responses: {
    201: {
      content: { "application/json": { schema: DeviceAuthorizationResponseSchema } },
      description: "Device authorization grant created.",
    },
    422: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Invalid authorization request.",
    },
  },
});

function resolveVerificationUri(fallback?: string): string {
  if (fallback) return fallback.replace(/\/+$/, "");
  const configured = process.env.PORTAL_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return "http://localhost:3000";
}

export function registerRequestDeviceAuthorizationRoute(
  app: OpenAPIHono,
  dependencies: {
    store: DeviceAuthorizationStorePort;
    issuer: DaemonCredentialIssuerPort;
    verificationUri?: string;
  },
): void {
  app.openapi(requestDeviceAuthorizationRoute, async (context) => {
    const body = context.req.valid("json");
    const authorized = await requestDeviceAuthorization(dependencies.store, {
      machineName: body.machineName ?? "unnamed-machine",
      verificationUri: resolveVerificationUri(dependencies.verificationUri),
      existingDaemonId: body.daemon_id ?? null,
    });
    context.header("Location", `/v1/device/authorizations/${authorized.device_code}`);
    return context.json({ ...authorized, verification_uri_complete: authorized.verification_uri }, 201);
  });
}
