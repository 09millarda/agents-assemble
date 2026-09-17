import type { HarnessCapability, WorkflowDaemonCommand, WorkflowDaemonFact } from "@factory/workflow";
import {
  isDaemonHarnessCapacityValid,
  type DaemonConfiguration,
  type DaemonRuntimeFacts,
  type DaemonTelemetry,
} from "@factory/shared-domain";
import { arch, cpus, platform, totalmem } from "node:os";
import { WebSocket } from "ws";
import type { DaemonConnectionPort } from "../domain/DaemonConnectionPort";

export interface WorkflowConnectionHandler {
  capabilities: HarnessCapability[];
  handleCommand(command: WorkflowDaemonCommand, emit: (fact: WorkflowDaemonFact) => Promise<void>): Promise<void>;
  applyConfiguration(configuration: DaemonConfiguration): Promise<{ applied: true } | { applied: false; reason: string }>;
  getTelemetry(): DaemonTelemetry;
  setTelemetryPublisher(publisher: (telemetry: DaemonTelemetry) => void): void;
  setLogPublisher(publisher: (source: "daemon-stdout" | "daemon-stderr" | "harness-stdout" | "harness-stderr", payload: string) => void): void;
}

export function collectDaemonRuntimeFacts(
  machineName: string,
  capabilities: HarnessCapability[],
): DaemonRuntimeFacts {
  return {
    machineName,
    operatingSystem: platform(),
    architecture: arch(),
    cpuCount: cpus().length,
    memoryBytes: totalmem(),
    daemonVersion: "0.0.0",
    harnessVersions: capabilities.map(({ harness, version }) => ({ harness, version })),
    capabilities,
    lastSeenAt: new Date().toISOString(),
  };
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
      let appliedConfigurationRevision = 0;
      const socket = new WebSocket(socketUrl, { headers: { authorization: `Bearer ${authToken}` } });
      socket.on("open", () => {
        socket.send(JSON.stringify({
          type: "daemon.hello",
          daemonId: this.daemonId,
          machineName: this.machineName,
          runtimeFacts: collectDaemonRuntimeFacts(this.machineName, this.workflow.capabilities),
        }));
      });
      socket.on("message", (raw) => {
        try {
          const frame = JSON.parse(String(raw));
          if (!isAuthenticated) {
            if (frame?.type === "daemon.welcome") {
              isAuthenticated = true;
              this.workflow.setTelemetryPublisher((telemetry) => {
                socket.send(JSON.stringify({ type: "daemon.telemetry", telemetry }));
              });
              this.workflow.setLogPublisher((source, payload) => {
                socket.send(JSON.stringify({ type: "daemon.log", source, payload }));
              });
              socket.send(JSON.stringify({
                type: "daemon.telemetry",
                telemetry: this.workflow.getTelemetry(),
              }));
              resolve();
            }
            return;
          }
          if (frame?.type === "daemon.configuration") {
            const revision = frame.revision;
            const configuration = frame.configuration as DaemonConfiguration;
            if (
              !Number.isInteger(revision) ||
              typeof configuration?.displayName !== "string" ||
              configuration.displayName.trim().length === 0 ||
              !isDaemonHarnessCapacityValid(configuration.maxParallelHarnesses)
            ) {
              socket.send(JSON.stringify({
                type: "daemon.configuration.rejected",
                revision: Number.isInteger(revision) ? revision : 0,
                reason: "Invalid daemon configuration.",
              }));
              return;
            }
            if (revision < appliedConfigurationRevision) {
              socket.send(JSON.stringify({
                type: "daemon.configuration.rejected",
                revision,
                reason: `Configuration revision ${revision} is stale.`,
              }));
              return;
            }
            if (revision === appliedConfigurationRevision) {
              socket.send(JSON.stringify({ type: "daemon.configuration.applied", revision }));
              return;
            }
            void this.workflow.applyConfiguration(configuration).then(
              (result) => {
                if (result.applied) appliedConfigurationRevision = revision;
                socket.send(JSON.stringify(result.applied
                  ? { type: "daemon.configuration.applied", revision }
                  : { type: "daemon.configuration.rejected", revision, reason: result.reason }));
              },
              (error: unknown) => {
                socket.send(JSON.stringify({
                  type: "daemon.configuration.rejected",
                  revision,
                  reason: error instanceof Error ? error.message : String(error),
                }));
              },
            );
            return;
          }
          if (frame?.type === "workflow.command" && frame.command?.daemonId === this.daemonId) {
            const emit = async (fact: WorkflowDaemonFact) => {
              try { socket.send(JSON.stringify({ type: "workflow.fact", daemonId: this.daemonId, fact })); } catch { /* Journal replays facts on reconnect. */ }
            };
            void this.workflow.handleCommand(frame.command as WorkflowDaemonCommand, emit).catch((error: unknown) => {
              const payload = `Workflow command ${String(frame.command?.commandId)} could not be handled: ${error instanceof Error ? error.message : String(error)}`;
              console.error(payload);
              socket.send(JSON.stringify({ type: "daemon.log", source: "daemon-stderr", payload }));
            });
          }
        } catch {
          socket.send(JSON.stringify({ type: "error", message: "invalid frame" }));
        }
      });
      socket.on("close", (code: number) => {
        this.workflow.setTelemetryPublisher(() => {});
        this.workflow.setLogPublisher(() => {});
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
