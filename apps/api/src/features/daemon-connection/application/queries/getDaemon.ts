import {
  resolveDaemonLiveStatus,
  type DaemonDetails,
  type DaemonId,
  type DomainError,
  type Result,
} from "@factory/shared-domain";
import type { DaemonPresencePort } from "../../domain/DaemonConnectionPort";
import type {
  DaemonQueryPort,
  DaemonTelemetryPort,
} from "../../domain/DaemonConfigurationPort";

export async function getDaemon(
  registry: DaemonQueryPort,
  presence: DaemonPresencePort,
  telemetry: DaemonTelemetryPort,
  daemonId: DaemonId,
): Promise<Result<DaemonDetails, DomainError>> {
  const daemon = await registry.findDaemon(daemonId);
  if (!daemon) {
    return {
      ok: false,
      error: { code: "DAEMON_NOT_FOUND", message: "Daemon not found." },
    };
  }
  const liveTelemetry = telemetry.getDaemonTelemetry(daemonId);
  return {
    ok: true,
    value: {
      ...daemon,
      status: resolveDaemonLiveStatus(
        daemon.status,
        presence.isDaemonConnected(daemonId),
      ),
      telemetry: liveTelemetry ? {
        ...liveTelemetry,
        desiredMaxParallelHarnesses:
          daemon.configuration.desired.maxParallelHarnesses,
      } : null,
    },
  };
}
