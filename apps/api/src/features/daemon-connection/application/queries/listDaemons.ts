import { compareDaemonIds, isDaemonDeregistered, resolveDaemonLiveStatus } from "@factory/shared-domain";
import type { DaemonSummary } from "@factory/shared-domain";
import { DEFAULT_PAGE_LIMIT, paginateById } from "../../../../infrastructure/http/pagination";
import type { Page } from "../../../../infrastructure/http/pagination";
import type { DaemonPresencePort, DaemonRegistryPort } from "../../domain/DaemonConnectionPort";
import type { DaemonTelemetryPort } from "../../domain/DaemonConfigurationPort";

export async function listDaemons(
  registry: DaemonRegistryPort,
  presence: DaemonPresencePort,
  telemetry: DaemonTelemetryPort,
  input: { limit?: number; cursor?: string | null } = {}
): Promise<Page<DaemonSummary>> {
  const persisted = await registry.listDaemons();
  const active = persisted.filter((daemon) => !isDaemonDeregistered(daemon.status));
  const live = active.map((daemon) => {
    const current = telemetry.getDaemonTelemetry(daemon.daemonId);
    return {
      ...daemon,
      status: resolveDaemonLiveStatus(daemon.status, presence.isDaemonConnected(daemon.daemonId)),
      appliedMaxParallelHarnesses:
        current?.appliedMaxParallelHarnesses ?? daemon.appliedMaxParallelHarnesses,
      activeHarnesses: current?.activeHarnesses ?? 0,
      queuedCommands: current?.queuedCommands ?? 0,
    };
  });
  const ordered = [...live].sort((first, second) => compareDaemonIds(first.daemonId, second.daemonId));
  return paginateById(ordered, (daemon) => daemon.daemonId, input.limit ?? DEFAULT_PAGE_LIMIT, input.cursor ?? null);
}
