import type { WebSocket } from "ws";
import type { DaemonId } from "@factory/shared-domain";
import type { DaemonDisconnectionPort, DaemonPresencePort } from "../domain/DaemonConnectionPort";

export class DaemonSocketRegistry implements DaemonPresencePort, DaemonDisconnectionPort {
  private readonly socketsByDaemonId = new Map<DaemonId, WebSocket>();

  attachDaemonSocket(daemonId: DaemonId, socket: WebSocket): void {
    this.socketsByDaemonId.set(daemonId, socket);
    socket.on("close", () => {
      if (this.socketsByDaemonId.get(daemonId) === socket) this.socketsByDaemonId.delete(daemonId);
    });
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
    return true;
  }

  disconnectDaemon(daemonId: DaemonId): void {
    const socket = this.socketsByDaemonId.get(daemonId);
    if (!socket) return;
    try {
      socket.close(4403, "daemon deregistered");
    } finally {
      if (this.socketsByDaemonId.get(daemonId) === socket) this.socketsByDaemonId.delete(daemonId);
    }
  }
}
