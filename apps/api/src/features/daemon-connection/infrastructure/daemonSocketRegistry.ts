import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type {
  DaemonConfiguration,
  DaemonId,
  DaemonTelemetry,
} from "@factory/shared-domain";
import type { DaemonDisconnectionPort, DaemonPresencePort } from "../domain/DaemonConnectionPort";
import type {
  DaemonConfigurationDeliveryPort,
  DaemonTelemetryPort,
} from "../domain/DaemonConfigurationPort";
import type { DaemonLogPublicationPort } from "../domain/DaemonLogPort";

export class DaemonSocketRegistry
  implements
    DaemonPresencePort,
    DaemonDisconnectionPort,
    DaemonConfigurationDeliveryPort,
    DaemonTelemetryPort
{
  private readonly socketsByDaemonId = new Map<DaemonId, WebSocket>();
  private readonly telemetryByDaemonId = new Map<DaemonId, DaemonTelemetry>();
  private readonly connectionSessionsByDaemonId = new Map<DaemonId, string>();

  constructor(private readonly logs?: DaemonLogPublicationPort) {}

  attachDaemonSocket(daemonId: DaemonId, socket: WebSocket): string {
    const previousSocket = this.socketsByDaemonId.get(daemonId);
    const connectionSessionId = this.logs?.startConnection(daemonId) ?? randomUUID();
    this.socketsByDaemonId.set(daemonId, socket);
    this.connectionSessionsByDaemonId.set(daemonId, connectionSessionId);
    if (previousSocket && previousSocket !== socket) {
      previousSocket.close(4409, "daemon connection superseded");
    }
    socket.on("close", () => {
      if (this.socketsByDaemonId.get(daemonId) === socket) {
        this.socketsByDaemonId.delete(daemonId);
        this.telemetryByDaemonId.delete(daemonId);
        this.connectionSessionsByDaemonId.delete(daemonId);
        this.logs?.endConnection(daemonId, connectionSessionId);
      }
    });
    return connectionSessionId;
  }

  hasDaemonConnected(daemonId: DaemonId): boolean {
    return this.isDaemonConnected(daemonId);
  }

  isDaemonConnected(daemonId: DaemonId): boolean {
    const socket = this.socketsByDaemonId.get(daemonId);
    return socket !== undefined && socket.readyState === socket.OPEN;
  }

  sendToDaemon(daemonId: DaemonId, payload: string): boolean {
    const socket = this.socketsByDaemonId.get(daemonId);
    if (!socket || socket.readyState !== socket.OPEN) return false;
    socket.send(payload);
    const connectionSessionId = this.connectionSessionsByDaemonId.get(daemonId);
    if (connectionSessionId) {
      this.logs?.publish(
        daemonId,
        connectionSessionId,
        "api-to-daemon",
        "websocket",
        payload,
      );
    }
    return true;
  }

  publishInboundFrame(
    daemonId: DaemonId,
    connectionSessionId: string,
    payload: string,
  ): boolean {
    return this.logs?.publish(
      daemonId,
      connectionSessionId,
      "daemon-to-api",
      "websocket",
      payload,
    ) ?? false;
  }

  publishLocalLog(
    daemonId: DaemonId,
    connectionSessionId: string,
    source: "daemon-stdout" | "daemon-stderr" | "harness-stdout" | "harness-stderr",
    payload: string,
  ): boolean {
    return this.logs?.publish(
      daemonId,
      connectionSessionId,
      "local",
      source,
      payload,
    ) ?? false;
  }

  sendConfiguration(
    daemonId: DaemonId,
    revision: number,
    configuration: DaemonConfiguration,
  ): boolean {
    return this.sendToDaemon(
      daemonId,
      JSON.stringify({
        type: "daemon.configuration",
        revision,
        configuration,
      }),
    );
  }

  recordDaemonTelemetry(
    daemonId: DaemonId,
    telemetry: DaemonTelemetry,
  ): void {
    this.telemetryByDaemonId.set(daemonId, structuredClone(telemetry));
  }

  getDaemonTelemetry(daemonId: DaemonId): DaemonTelemetry | null {
    const telemetry = this.telemetryByDaemonId.get(daemonId);
    return telemetry ? structuredClone(telemetry) : null;
  }

  disconnectDaemon(daemonId: DaemonId): void {
    const socket = this.socketsByDaemonId.get(daemonId);
    if (!socket) return;
    try {
      socket.close(4403, "daemon deregistered");
    } finally {
      if (this.socketsByDaemonId.get(daemonId) === socket) {
        this.socketsByDaemonId.delete(daemonId);
        this.telemetryByDaemonId.delete(daemonId);
        const connectionSessionId = this.connectionSessionsByDaemonId.get(daemonId);
        this.connectionSessionsByDaemonId.delete(daemonId);
        if (connectionSessionId) this.logs?.endConnection(daemonId, connectionSessionId);
      }
    }
  }
}
