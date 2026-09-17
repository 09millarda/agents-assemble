import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { DaemonDetails } from "@factory/shared-domain";
import { EphemeralDaemonLogBroker } from "../../../../../features/daemon-connection/infrastructure/EphemeralDaemonLogBroker";
import { registerStreamDaemonLogsRoute } from "./stream.get";
import { validationHook } from "../../../../../infrastructure/http/validationHook";

const daemon: DaemonDetails = {
  daemonId: "daemon-1",
  machineName: "workstation",
  status: "online",
  configuration: {
    desired: {
      displayName: "Build workstation",
      maxParallelHarnesses: 2,
      location: "Studio",
      deviceLabel: "tower",
      purpose: "Builds",
      ownerTeam: "Platform",
      tags: [],
      notes: "",
    },
    applied: null,
    revision: 1,
    appliedRevision: null,
    status: "pending",
    failureReason: null,
  },
  runtimeFacts: null,
  telemetry: null,
};

test("GET /v1/daemons/{daemonId}/logs/stream requires disclosure acknowledgement and streams new exact logs", async () => {
  const broker = new EphemeralDaemonLogBroker();
  const app = new OpenAPIHono({ defaultHook: validationHook });
  registerStreamDaemonLogsRoute(app, {
    registry: { findDaemon: async (daemonId) => daemonId === daemon.daemonId ? daemon : null },
    logs: broker,
  });

  const undisclosed = await app.request("/v1/daemons/daemon-1/logs/stream");
  expect(undisclosed.status).toBe(422);

  const response = await app.request(
    "/v1/daemons/daemon-1/logs/stream?acknowledgeSensitiveData=true",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const session = broker.startConnection("daemon-1");
  broker.publish(
    "daemon-1",
    session,
    "daemon-to-api",
    "harness-stderr",
    "token=raw-and-unchanged",
  );

  const reader = response.body!.getReader();
  const first = await reader.read();
  await reader.cancel();
  const payload = new TextDecoder().decode(first.value);
  expect(payload).toContain("event: daemon.log");
  expect(payload).toContain("token=raw-and-unchanged");
});
