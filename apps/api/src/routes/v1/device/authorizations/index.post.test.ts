import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { DaemonCredentialIssuerPort, DeviceAuthorizationStorePort } from "../../../../features/device-authorization/domain/DeviceAuthorizationPort";
import { registerRequestDeviceAuthorizationRoute } from "./index.post";

const store: DeviceAuthorizationStorePort = {
  saveAuthorization: async () => {},
  findByDeviceCode: async () => null,
  findByUserCode: async () => null,
  updateAuthorization: async () => {},
};
const issuer: DaemonCredentialIssuerPort = {
  issueDaemonCredentials: async () => ({ daemonId: "daemon-1", authToken: "token", authTokenHash: "hash" }),
};

test("POST /v1/device/authorizations creates a grant with its location", async () => {
  const app = new OpenAPIHono();
  registerRequestDeviceAuthorizationRoute(app, { store, issuer, verificationUri: "http://portal" });

  const response = await app.request("/v1/device/authorizations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ machineName: "workstation" }),
  });
  const body = await response.json();

  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toBe(`/v1/device/authorizations/${body.device_code}`);
  expect(body.verification_uri_complete).toBe(body.verification_uri);
});
