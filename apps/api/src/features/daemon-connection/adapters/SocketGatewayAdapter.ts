import { WorkflowFactSchema } from "../../workflow-delivery/adapters/inbound/dto/workflowFactDto";
import type { WorkflowDaemonGatewayPort } from "../../workflow-delivery/domain/WorkflowDaemonGatewayPort";
import type { HarnessCapability } from "@factory/workflow";
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { DaemonRegistryPort } from "../domain/DaemonConnectionPort";
import type { DaemonSocketRegistry } from "../infrastructure/daemonSocketRegistry";
import type {
  DaemonConfigurationStatePort,
  DaemonQueryPort,
  DaemonRuntimeFactsPort,
} from "../domain/DaemonConfigurationPort";
import {
  DaemonRuntimeFactsSchema,
  DaemonTelemetrySchema,
} from "./inbound/dto/daemonDto";

type DaemonSocketControlPort = DaemonQueryPort &
  DaemonConfigurationStatePort &
  DaemonRuntimeFactsPort;

function readBearerToken(
  authorizationHeader: string | string[] | undefined,
): string {
  const header = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : (authorizationHeader ?? "");
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

async function handleDaemonSocket(
  socket: WebSocket,
  request: { headers: { authorization?: string | string[] } },
  registry: DaemonRegistryPort,
  daemonSockets: DaemonSocketRegistry,
  workflowGateway?: WorkflowDaemonGatewayPort,
  daemonControl?: DaemonSocketControlPort,
): Promise<void> {
  const authToken = readBearerToken(request.headers.authorization);
  socket.once("message", async (raw) => {
    let hello: {
      type?: unknown;
      daemonId?: unknown;
      machineName?: unknown;
      runtimeFacts?: unknown;
    };
    try {
      hello = JSON.parse(String(raw));
    } catch {
      socket.close(4400, "invalid hello frame");
      return;
    }
    if (hello?.type !== "daemon.hello" || typeof hello?.daemonId !== "string") {
      socket.close(4400, "expected daemon.hello first");
      return;
    }
    const runtimeFacts = DaemonRuntimeFactsSchema.safeParse(hello.runtimeFacts);
    if (
      typeof hello.machineName !== "string" ||
      hello.machineName.length === 0 ||
      !runtimeFacts.success ||
      runtimeFacts.data.machineName !== hello.machineName
    ) {
      socket.close(4400, "invalid daemon runtime facts");
      return;
    }
    const isAuthenticated = await registry.verifyDaemonToken(
      hello.daemonId,
      authToken,
    );
    if (!isAuthenticated) {
      socket.close(4401, "invalid daemon credentials");
      return;
    }
    await registry.updateDaemonOnHello(hello.daemonId, hello.machineName);
    const connectionSessionId = daemonSockets.attachDaemonSocket(hello.daemonId, socket);
    daemonSockets.publishInboundFrame(hello.daemonId, connectionSessionId, String(raw));
    if (daemonControl) {
      await daemonControl.recordRuntimeFacts(hello.daemonId, {
        ...runtimeFacts.data,
        lastSeenAt: new Date().toISOString(),
      });
    }
    console.log(`daemon ${hello.daemonId} authenticated`);
    daemonSockets.sendToDaemon(
      hello.daemonId,
      JSON.stringify({ type: "daemon.welcome", daemonId: hello.daemonId }),
    );
    const authenticatedDaemonId = hello.daemonId;
    socket.on("message", async (frameRaw) => {
      const rawPayload = String(frameRaw);
      daemonSockets.publishInboundFrame(
        authenticatedDaemonId,
        connectionSessionId,
        rawPayload,
      );
      try {
        const frame = JSON.parse(rawPayload);
        if (frame?.type === "workflow.fact" && workflowGateway) {
          const parsed = WorkflowFactSchema.safeParse(frame.fact);
          if (
            !parsed.success ||
            !(await workflowGateway.acceptFact(
              authenticatedDaemonId,
              parsed.data,
            ))
          )
            daemonSockets.sendToDaemon(
              authenticatedDaemonId,
              JSON.stringify({
                type: "error",
                message: "Unrecognized workflow execution fact.",
              }),
            );
          return;
        }
        if (
          frame?.type === "daemon.configuration.applied" &&
          Number.isInteger(frame.revision) &&
          daemonControl
        ) {
          await daemonControl.recordAppliedConfiguration(
            authenticatedDaemonId,
            frame.revision,
          );
          return;
        }
        if (
          frame?.type === "daemon.configuration.rejected" &&
          Number.isInteger(frame.revision) &&
          typeof frame.reason === "string" &&
          daemonControl
        ) {
          await daemonControl.recordRejectedConfiguration(
            authenticatedDaemonId,
            frame.revision,
            frame.reason,
          );
          return;
        }
        if (frame?.type === "daemon.telemetry") {
          const telemetry = DaemonTelemetrySchema.safeParse(frame.telemetry);
          if (!telemetry.success) throw new Error("invalid telemetry");
          daemonSockets.recordDaemonTelemetry(
            authenticatedDaemonId,
            telemetry.data,
          );
          return;
        }
        if (
          frame?.type === "daemon.log" &&
          [
            "daemon-stdout",
            "daemon-stderr",
            "harness-stdout",
            "harness-stderr",
          ].includes(frame.source) &&
          typeof frame.payload === "string"
        ) {
          daemonSockets.publishLocalLog(
            authenticatedDaemonId,
            connectionSessionId,
            frame.source,
            frame.payload,
          );
          return;
        }
      } catch {
        daemonSockets.sendToDaemon(
          authenticatedDaemonId,
          JSON.stringify({ type: "error", message: "invalid frame" }),
        );
      }
    });
    if (daemonControl) {
      const details = await daemonControl.findDaemon(authenticatedDaemonId);
      if (details) {
        daemonSockets.sendConfiguration(
          authenticatedDaemonId,
          details.configuration.revision,
          details.configuration.desired,
        );
      }
    }
    if (workflowGateway)
      await workflowGateway.connectDaemon(
        authenticatedDaemonId,
        runtimeFacts.data.capabilities as HarnessCapability[],
      );
  });
}

export function attachSocketGateway(
  server: Server,
  registry: DaemonRegistryPort,
  daemonSockets: DaemonSocketRegistry,
  workflowGateway?: WorkflowDaemonGatewayPort,
  daemonControl?: DaemonSocketControlPort,
): void {
  new WebSocketServer({ server }).on(
    "connection",
    (socket: WebSocket, request) => {
      const url = new URL(request.url ?? "", "http://localhost");
      if (url.pathname === "/ws/daemon") {
        void handleDaemonSocket(
          socket,
          request,
          registry,
          daemonSockets,
          workflowGateway,
          daemonControl,
        );
      } else {
        socket.close(4404, "unknown socket path");
      }
    },
  );
}
