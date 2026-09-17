import { compareDaemonIds, isDaemonDeregistered, resolveDaemonLiveStatus } from "@factory/shared-domain";
import type { DaemonSummary } from "@factory/shared-domain";
import { DEFAULT_PAGE_LIMIT, paginateById } from "../../../../infrastructure/http/pagination";
import type { Page } from "../../../../infrastructure/http/pagination";
import type { DaemonPresencePort, DaemonRegistryPort } from "../../domain/DaemonConnectionPort";

export async function listDaemons(
  registry: DaemonRegistryPort,
  presence: DaemonPresencePort,
  input: { limit?: number; cursor?: string | null } = {}
): Promise<Page<DaemonSummary>> {
  const persisted = await registry.listDaemons();
  const active = persisted.filter((daemon) => !isDaemonDeregistered(daemon.status));
  const live = active.map((daemon) => ({
    ...daemon,
    status: resolveDaemonLiveStatus(daemon.status, presence.isDaemonConnected(daemon.daemonId)),
  }));
  const ordered = [...live].sort((first, second) => compareDaemonIds(first.daemonId, second.daemonId));
  return paginateById(ordered, (daemon) => daemon.daemonId, input.limit ?? DEFAULT_PAGE_LIMIT, input.cursor ?? null);
}
