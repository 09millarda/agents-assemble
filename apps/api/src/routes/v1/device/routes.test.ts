import { describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { DaemonCredentialIssuerPort, DeviceAuthorizationRecord, DeviceAuthorizationStorePort } from "../../../features/device-authorization/domain/DeviceAuthorizationPort";
import { validationHook } from "../../../infrastructure/http/validationHook";
import { registerApproveDeviceAuthorizationRoute } from "./approve.post";
import { registerReadDeviceAuthorizationRoute } from "./authorizations/[deviceCode].get";
import { registerRequestDeviceAuthorizationRoute } from "./authorizations/index.post";
import { registerDenyDeviceAuthorizationRoute } from "./deny.post";
import { registerPollForDeviceTokenRoute } from "./token.post";

function recordWith(overrides: Partial<DeviceAuthorizationRecord>): DeviceAuthorizationRecord {
  return {
    deviceCode: "device-code-1",
    userCode: "ABCD-2345",
    status: "pending",
    expiresAtMs: Date.now() + 600_000,
    machineName: "workstation",
    pollIntervalSeconds: 5,
    lastPolledAtMs: 0,
    daemonId: null,
    authToken: null,
    requestedDaemonId: null,
    ...overrides,
  };
}

function stubStore(record: DeviceAuthorizationRecord | null): DeviceAuthorizationStorePort {
  return {
    saveAuthorization: async () => {},
    findByDeviceCode: async () => record,
    findByUserCode: async () => record,
    updateAuthorization: async () => {},
  };
}

const issuer: DaemonCredentialIssuerPort = {
  issueDaemonCredentials: async (machineName) => ({ daemonId: `daemon-for-${machineName}`, authToken: "token-1", authTokenHash: "hash-1" }),
};

function buildDeviceAuthorizationRoutes(
  store: DeviceAuthorizationStorePort,
  credentialIssuer: DaemonCredentialIssuerPort = issuer,
  verificationUri?: string,
): OpenAPIHono {
  const app = new OpenAPIHono({ defaultHook: validationHook });
  registerRequestDeviceAuthorizationRoute(app, { store, issuer: credentialIssuer, verificationUri });
  registerReadDeviceAuthorizationRoute(app, { store });
  registerPollForDeviceTokenRoute(app, { store });
  registerApproveDeviceAuthorizationRoute(app, { store, issuer: credentialIssuer });
  registerDenyDeviceAuthorizationRoute(app, { store });
  return app;
}

describe("device authorization routes", () => {
  test("POST /v1/device/authorizations creates a grant with a location", async () => {
    const routes = buildDeviceAuthorizationRoutes(stubStore(null), issuer, "http://portal");
    const response = await routes.request("/v1/device/authorizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ machineName: "workstation" }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(`/v1/device/authorizations/${body.device_code}`);
    expect(typeof body.device_code).toBe("string");
    expect(typeof body.user_code).toBe("string");
    expect(body.verification_uri).toBe(`http://portal/#/device?code=${encodeURIComponent(body.user_code)}`);
    expect(body.verification_uri_complete).toBe(body.verification_uri);
    expect(body.expires_in).toBe(600);
    expect(typeof body.interval).toBe("number");
  });

  test("GET /v1/device/authorizations/:deviceCode reports the grant status", async () => {
    const routes = buildDeviceAuthorizationRoutes(stubStore(recordWith({ expiresAtMs: 1_600_000, status: "pending" })));
    const response = await routes.request("/v1/device/authorizations/device-code-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deviceCode: "device-code-1",
      status: "expired",
      expiresAt: "1970-01-01T00:26:40.000Z",
    });
  });

  test("GET /v1/device/authorizations/:deviceCode maps unknown codes to a 404 problem", async () => {
    const response = await buildDeviceAuthorizationRoutes(stubStore(null)).request("/v1/device/authorizations/missing");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).toMatchObject({ status: 404, code: "UNKNOWN_DEVICE_CODE" });
  });

  test("POST /v1/device/token reports pending while waiting", async () => {
    const response = await buildDeviceAuthorizationRoutes(stubStore(recordWith({}))).request("/v1/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: "device-code-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "pending" });
  });

  test("POST /v1/device/token issues credentials once approved", async () => {
    const response = await buildDeviceAuthorizationRoutes(
      stubStore(recordWith({ status: "approved", daemonId: "daemon-1", authToken: "token-1" })),
    ).request("/v1/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: "device-code-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "approved", daemonId: "daemon-1", authToken: "token-1" });
  });

  test("POST /v1/device/token maps denial to a 403 problem", async () => {
    const response = await buildDeviceAuthorizationRoutes(stubStore(recordWith({ status: "denied" }))).request("/v1/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: "device-code-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).toMatchObject({ status: 403, code: "access_denied" });
  });

  test("POST /v1/device/token maps expiry to a 410 problem", async () => {
    const response = await buildDeviceAuthorizationRoutes(stubStore(recordWith({ expiresAtMs: 1 }))).request("/v1/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: "device-code-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toMatchObject({ status: 410, code: "expired_token" });
  });

  test("POST /v1/device/approve authorizes the daemon", async () => {
    const response = await buildDeviceAuthorizationRoutes(stubStore(recordWith({}))).request("/v1/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_code: "ABCD-2345" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ daemonId: "daemon-for-workstation" });
  });

  test("POST /v1/device/approve maps unknown codes to a 400 problem", async () => {
    const response = await buildDeviceAuthorizationRoutes(stubStore(null)).request("/v1/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_code: "ABCD-2345" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).toMatchObject({ status: 400, code: "UNKNOWN_USER_CODE" });
  });

  test("POST /v1/device/approve maps an unusable code to a 400 problem", async () => {
    const response = await buildDeviceAuthorizationRoutes(stubStore(recordWith({}))).request("/v1/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_code: "WXYZ-6789" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ status: 400, code: "INVALID_USER_CODE" });
  });

  test("POST /v1/device/deny rejects the grant", async () => {
    const response = await buildDeviceAuthorizationRoutes(stubStore(recordWith({}))).request("/v1/device/deny", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_code: "ABCD-2345" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ denied: true });
  });

  test("the unversioned device paths are gone", async () => {
    const response = await buildDeviceAuthorizationRoutes(stubStore(recordWith({}))).request("/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: "device-code-1" }),
    });

    expect(response.status).toBe(404);
  });
});
