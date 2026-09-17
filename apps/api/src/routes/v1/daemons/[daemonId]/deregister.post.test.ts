import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { DaemonRegistryPort } from "../../../../features/daemon-connection/domain/DaemonConnectionPort";
import { registerDeregisterDaemonRoute } from "./deregister.post";

function fakeRegistry(): DaemonRegistryPort {
  return {
    issueDaemonCredentials: async () => ({ daemonId: "daemon-1", authToken: "token", authTokenHash: "hash" }),
    updateDaemonOnHello: async () => {},
    listKnownDaemons: async () => [],
    listDaemons: async () => [],
    verifyDaemonToken: async () => true,
    deregisterDaemon: async (daemonId) => daemonId === "daemon-1" ? "deregistered" : "not-found",
  };
}

test("POST /v1/daemons/{daemonId}/deregister returns a deregistered daemon", async () => {
  const app = new OpenAPIHono();
  const disconnected: string[] = [];
  registerDeregisterDaemonRoute(app, {
    registry: fakeRegistry(),
    disconnection: { disconnectDaemon: (daemonId) => disconnected.push(daemonId) },
  });

  const response = await app.request("/v1/daemons/daemon-1/deregister", { method: "POST" });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ daemonId: "daemon-1", status: "deregistered" });
  expect(disconnected).toEqual(["daemon-1"]);
});

test("POST deregister maps an unknown daemon to a 404 problem", async () => {
  const app = new OpenAPIHono();
  registerDeregisterDaemonRoute(app, {
    registry: fakeRegistry(),
    disconnection: { disconnectDaemon: () => {} },
  });

  const response = await app.request("/v1/daemons/missing/deregister", { method: "POST" });

  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ status: 404, code: "DAEMON_NOT_FOUND" });
});
