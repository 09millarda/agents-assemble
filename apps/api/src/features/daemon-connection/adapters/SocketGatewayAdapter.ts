import { WorkflowFactSchema } from "../../workflow-delivery/adapters/inbound/dto/workflowFactDto";
import type { WorkflowDaemonGatewayPort } from "../../workflow-delivery/domain/WorkflowDaemonGatewayPort";
import type { HarnessCapability } from "@factory/workflow";
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { DaemonRegistryPort } from "../domain/DaemonConnectionPort";
import type { DaemonSocketRegistry } from "../infrastructure/daemonSocketRegistry";

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
): Promise<void> {
  const authToken = readBearerToken(request.headers.authorization);
  socket.once("message", async (raw) => {
    let hello: {
      type?: unknown;
      daemonId?: unknown;
      machineName?: unknown;
      capabilities?: unknown;
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
    const isAuthenticated = await registry.verifyDaemonToken(
      hello.daemonId,
      authToken,
    );
    if (!isAuthenticated) {
      socket.close(4401, "invalid daemon credentials");
      return;
    }
    if (
      typeof hello?.machineName === "string" &&
      hello.machineName.length > 0
    ) {
      await registry.updateDaemonOnHello(hello.daemonId, hello.machineName);
    }
    daemonSockets.attachDaemonSocket(hello.daemonId, socket);
    console.log(`daemon ${hello.daemonId} authenticated`);
    socket.send(
      JSON.stringify({ type: "daemon.welcome", daemonId: hello.daemonId }),
    );
    const authenticatedDaemonId = hello.daemonId;
    socket.on("message", async (frameRaw) => {
      try {
        const frame = JSON.parse(String(frameRaw));
        if (frame?.type === "workflow.fact" && workflowGateway) {
          const parsed = WorkflowFactSchema.safeParse(frame.fact);
          if (
            !parsed.success ||
            !(await workflowGateway.acceptFact(
              authenticatedDaemonId,
              parsed.data,
            ))
          )
            socket.send(
              JSON.stringify({
                type: "error",
                message: "Unrecognized workflow execution fact.",
              }),
            );
          return;
        }
      } catch {
        socket.send(
          JSON.stringify({ type: "error", message: "invalid frame" }),
        );
      }
    });
    if (workflowGateway)
      await workflowGateway.connectDaemon(
        authenticatedDaemonId,
        Array.isArray(hello.capabilities)
          ? (hello.capabilities as HarnessCapability[])
          : [],
      );
  });
}

export function attachSocketGateway(
  server: Server,
  registry: DaemonRegistryPort,
  daemonSockets: DaemonSocketRegistry,
  workflowGateway?: WorkflowDaemonGatewayPort,
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
        );
      } else {
        socket.close(4404, "unknown socket path");
      }
    },
  );
}
