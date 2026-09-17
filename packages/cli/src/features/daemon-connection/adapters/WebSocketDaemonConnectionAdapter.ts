import type { HarnessCapability, WorkflowDaemonCommand, WorkflowDaemonFact } from "@factory/workflow";
import { WebSocket } from "ws";
import type { DaemonConnectionPort } from "../domain/DaemonConnectionPort";

export interface WorkflowConnectionHandler {
  capabilities: HarnessCapability[];
  handleCommand(command: WorkflowDaemonCommand, emit: (fact: WorkflowDaemonFact) => Promise<void>): Promise<void>;
}

export class DaemonAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonAuthenticationError";
  }
}

export class WebSocketDaemonConnectionAdapter implements DaemonConnectionPort {
  constructor(
    private readonly daemonId: string,
    private readonly machineName: string,
    private readonly workflow: WorkflowConnectionHandler,
    private readonly onDisconnect: () => void = () => {}
  ) {}

  async connectToFactoryApi(factoryApiUrl: string, authToken: string): Promise<void> {
    const socketUrl = factoryApiUrl.replace(/^http/, "ws") + "/ws/daemon";
    await new Promise<void>((resolve, reject) => {
      let isAuthenticated = false;
      const socket = new WebSocket(socketUrl, { headers: { authorization: `Bearer ${authToken}` } });
      socket.on("open", () => {
        socket.send(JSON.stringify({ type: "daemon.hello", daemonId: this.daemonId, machineName: this.machineName, capabilities: this.workflow.capabilities }));
      });
      socket.on("message", (raw) => {
        try {
          const frame = JSON.parse(String(raw));
          if (!isAuthenticated) {
            if (frame?.type === "daemon.welcome") {
              isAuthenticated = true;
              resolve();
            }
            return;
          }
          if (frame?.type === "workflow.command" && frame.command?.daemonId === this.daemonId) {
            const emit = async (fact: WorkflowDaemonFact) => {
              try { socket.send(JSON.stringify({ type: "workflow.fact", daemonId: this.daemonId, fact })); } catch { /* Journal replays facts on reconnect. */ }
            };
            void this.workflow.handleCommand(frame.command as WorkflowDaemonCommand, emit).catch((error: unknown) => {
              console.error(`Workflow command ${String(frame.command?.commandId)} could not be handled: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
        } catch {
          socket.send(JSON.stringify({ type: "error", message: "invalid frame" }));
        }
      });
      socket.on("close", (code: number) => {
        if (!isAuthenticated) {
          reject(code === 4401 ? new DaemonAuthenticationError("Daemon credentials were rejected.") : new Error(`Daemon connection closed before welcome (code ${code}).`));
        } else {
          this.onDisconnect();
        }
      });
      socket.on("error", (error) => {
        if (!isAuthenticated) reject(error);
        else this.onDisconnect();
      });
    });
  }
}
