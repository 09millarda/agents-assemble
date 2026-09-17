import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { DaemonPresencePort, DaemonRegistryPort } from "../../../features/daemon-connection/domain/DaemonConnectionPort";
import { validationHook } from "../../../infrastructure/http/validationHook";
import { registerListDaemonsRoute } from "./index.get";

function fakeRegistry(): DaemonRegistryPort {
  return {
    issueDaemonCredentials: async () => ({ daemonId: "daemon-1", authToken: "token", authTokenHash: "hash" }),
    updateDaemonOnHello: async () => {},
    listKnownDaemons: async () => [],
    listDaemons: async () => [
      { daemonId: "daemon-b", machineName: "laptop", status: "offline" },
      { daemonId: "daemon-a", machineName: "workstation", status: "offline" },
    ],
    verifyDaemonToken: async () => true,
    deregisterDaemon: async () => "not-found",
  };
}

const offlinePresence: DaemonPresencePort = { isDaemonConnected: () => false };

test("GET /v1/daemons returns a paged daemon collection", async () => {
  const app = new OpenAPIHono();
  registerListDaemonsRoute(app, { registry: fakeRegistry(), presence: offlinePresence });

  const response = await app.request("/v1/daemons?limit=1");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: [{ daemonId: "daemon-a", machineName: "workstation", status: "offline" }],
    pagination: { nextCursor: "ZGFlbW9uLWE", limit: 1 },
  });
  expect(response.headers.get("link")).toBe('</v1/daemons?limit=1&cursor=ZGFlbW9uLWE>; rel="next"');
});

test("GET /v1/daemons rejects an out-of-range limit as a problem", async () => {
  const app = new OpenAPIHono({ defaultHook: validationHook });
  registerListDaemonsRoute(app, { registry: fakeRegistry(), presence: offlinePresence });

  const response = await app.request("/v1/daemons?limit=500");

  expect(response.status).toBe(422);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(await response.json()).toMatchObject({ status: 422, code: "VALIDATION_FAILED", instance: "/v1/daemons" });
});

test("the unversioned daemon path is gone", async () => {
  const app = new OpenAPIHono();
  registerListDaemonsRoute(app, { registry: fakeRegistry(), presence: offlinePresence });

  expect((await app.request("/daemons")).status).toBe(404);
});
