import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { DaemonDetails } from "@factory/shared-domain";
import type { DaemonPresencePort } from "../../../../features/daemon-connection/domain/DaemonConnectionPort";
import type {
  DaemonQueryPort,
  DaemonTelemetryPort,
} from "../../../../features/daemon-connection/domain/DaemonConfigurationPort";
import { registerGetDaemonRoute } from "./index.get";

test("GET /v1/daemons/{daemonId} combines persisted configuration with live presence and telemetry", async () => {
  const stored: DaemonDetails = {
    daemonId: "daemon-1",
    machineName: "reported-host",
    status: "offline",
    configuration: {
      desired: {
        displayName: "Build machine",
        maxParallelHarnesses: 2,
        location: "London",
        deviceLabel: "Workstation",
        purpose: "Feature delivery",
        ownerTeam: "Platform",
        tags: ["linux"],
        notes: "",
      },
      applied: null,
      revision: 2,
      appliedRevision: null,
      status: "pending",
      failureReason: null,
    },
    runtimeFacts: null,
    telemetry: null,
  };
  const registry: DaemonQueryPort = {
    findDaemon: async () => stored,
  };
  const presence: DaemonPresencePort = {
    isDaemonConnected: () => true,
  };
  const telemetry: DaemonTelemetryPort = {
    getDaemonTelemetry: () => ({
      activeHarnesses: 1,
      queuedCommands: 2,
      desiredMaxParallelHarnesses: 2,
      appliedMaxParallelHarnesses: 2,
    }),
  };
  const app = new OpenAPIHono();
  registerGetDaemonRoute(app, { registry, presence, telemetry });

  const response = await app.request("/v1/daemons/daemon-1");

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    daemonId: "daemon-1",
    status: "online",
    telemetry: { activeHarnesses: 1, queuedCommands: 2 },
  });
});
