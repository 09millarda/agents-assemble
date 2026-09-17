import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { DaemonCapabilityPort } from "../../../../features/workflow-delivery/domain/DaemonCapabilityPort";
import { registerGetDaemonCapabilitiesRoute } from "./capabilities.get";

const capabilities: DaemonCapabilityPort = {
  getCapabilities: (daemonId) => daemonId === "daemon-1" ? [{
    harness: "codex",
    version: "0.154.0",
    models: [{ model: "gpt-5.6-sol", efforts: ["high"] }],
    questions: true,
    permissions: true,
    structuredOutput: true,
  }] : [],
};

test("GET /v1/daemons/{daemonId}/capabilities returns the daemon capabilities", async () => {
  const app = new OpenAPIHono();
  registerGetDaemonCapabilitiesRoute(app, { capabilities });

  const response = await app.request("/v1/daemons/daemon-1/capabilities");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: [{
      harness: "codex",
      version: "0.154.0",
      models: [{ model: "gpt-5.6-sol", efforts: ["high"] }],
      questions: true,
      permissions: true,
      structuredOutput: true,
    }],
    pagination: { nextCursor: null, limit: 100 },
  });
});
