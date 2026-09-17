import type { DaemonSummary } from "@factory/shared-domain";
import { deregisterDaemon } from "./deregisterDaemon";
import { listDaemons } from "./listDaemons";
import type { DaemonRegistryPort } from "../domain/DaemonRegistryPort";

export interface DaemonRegistrySnapshot {
  daemons: DaemonSummary[];
  isLoading: boolean;
  error: string | null;
}

export interface DaemonRegistryStore {
  getSnapshot(): DaemonRegistrySnapshot;
  subscribe(listener: () => void): () => void;
  refreshDaemons(): Promise<void>;
  deregisterDaemon(daemonId: string): Promise<void>;
}

function describeRefreshError(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to load daemons.";
}

export function createDaemonRegistryStore(registry: DaemonRegistryPort): DaemonRegistryStore {
  let snapshot: DaemonRegistrySnapshot = {
    daemons: [],
    isLoading: true,
    error: null,
  };
  let refreshInFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function publish(nextSnapshot: DaemonRegistrySnapshot): void {
    snapshot = nextSnapshot;
    for (const listener of listeners) listener();
  }

  async function refreshDaemons(): Promise<void> {
    if (refreshInFlight) return refreshInFlight;

    const pendingRefresh = loadDaemons();
    refreshInFlight = pendingRefresh;
    try {
      await pendingRefresh;
    } finally {
      if (refreshInFlight === pendingRefresh) refreshInFlight = null;
    }
  }

  async function loadDaemons(): Promise<void> {
    publish({ ...snapshot, isLoading: true, error: null });
    try {
      const daemons = await listDaemons(registry);
      publish({ daemons, isLoading: false, error: null });
    } catch (error) {
      publish({ ...snapshot, isLoading: false, error: describeRefreshError(error) });
    }
  }

  async function removeDaemon(daemonId: string): Promise<void> {
    await deregisterDaemon(registry, daemonId);
    await refreshDaemons();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refreshDaemons,
    deregisterDaemon: removeDaemon,
  };
}
