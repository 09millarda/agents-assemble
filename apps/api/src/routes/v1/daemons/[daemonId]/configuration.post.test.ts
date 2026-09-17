import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type {
  DaemonConfiguration,
  DaemonDetails,
} from "@factory/shared-domain";
import type {
  DaemonConfigurationDeliveryPort,
  DaemonConfigurationPort,
} from "../../../../features/daemon-connection/domain/DaemonConfigurationPort";
import { validationHook } from "../../../../infrastructure/http/validationHook";
import { registerSaveDaemonConfigurationRoute } from "./configuration.post";

const desired: DaemonConfiguration = {
  displayName: "Build machine",
  maxParallelHarnesses: 2,
  location: "London",
  deviceLabel: "Workstation",
  purpose: "Feature delivery",
  ownerTeam: "Platform",
  tags: ["linux"],
  notes: "",
};

test("POST /v1/daemons/{daemonId}/configuration saves the complete desired configuration", async () => {
  const details: DaemonDetails = {
    daemonId: "daemon-1",
    machineName: "reported-host",
    status: "online",
    configuration: {
      desired,
      applied: null,
      revision: 2,
      appliedRevision: null,
      status: "pending",
      failureReason: null,
    },
    runtimeFacts: null,
    telemetry: null,
  };
  const registry: DaemonConfigurationPort = {
    saveDesiredConfiguration: async () => details,
  };
  const delivery: DaemonConfigurationDeliveryPort = {
    sendConfiguration: () => false,
  };
  const app = new OpenAPIHono({ defaultHook: validationHook });
  registerSaveDaemonConfigurationRoute(app, { registry, delivery });

  const response = await app.request(
    "/v1/daemons/daemon-1/configuration",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(desired),
    },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(details);
});
