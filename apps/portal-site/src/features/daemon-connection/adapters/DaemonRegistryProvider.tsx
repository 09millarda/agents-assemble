import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { HttpDaemonRegistryAdapter } from "./HttpDaemonRegistryAdapter";
import { createDaemonRegistryStore, type DaemonRegistryStore } from "../application/DaemonRegistryStore";
import type { DaemonRegistryPort } from "../domain/DaemonRegistryPort";

const DAEMON_REFRESH_INTERVAL_MS = 30_000;

interface DaemonRegistryContextValue extends ReturnType<DaemonRegistryStore["getSnapshot"]> {
  refreshDaemons(): Promise<void>;
  deregisterDaemon(daemonId: string): Promise<void>;
}

const DaemonRegistryContext = createContext<DaemonRegistryContextValue | null>(null);

export function DaemonRegistryProvider({
  children,
  registry,
}: {
  children: ReactNode;
  registry?: DaemonRegistryPort;
}) {
  const resolvedRegistry = useMemo(() => registry ?? new HttpDaemonRegistryAdapter(), [registry]);
  const store = useMemo(() => createDaemonRegistryStore(resolvedRegistry), [resolvedRegistry]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    void store.refreshDaemons();
    const refreshTimer = window.setInterval(() => void store.refreshDaemons(), DAEMON_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(refreshTimer);
  }, [store]);

  const value = useMemo<DaemonRegistryContextValue>(
    () => ({
      ...snapshot,
      refreshDaemons: store.refreshDaemons,
      deregisterDaemon: store.deregisterDaemon,
    }),
    [snapshot, store],
  );

  return <DaemonRegistryContext.Provider value={value}>{children}</DaemonRegistryContext.Provider>;
}

export function useDaemonRegistry(): DaemonRegistryContextValue {
  const context = useContext(DaemonRegistryContext);
  if (!context) throw new Error("useDaemonRegistry must be used within DaemonRegistryProvider.");
  return context;
}
