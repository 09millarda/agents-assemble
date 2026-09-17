import { DrizzleDaemonRegistryAdapter } from "../adapters/DrizzleDaemonRegistryAdapter";
import { createDatabaseConnection } from "@factory/db";
import type { DaemonDisconnectionPort, DaemonPresencePort, DaemonRegistryPort } from "../domain/DaemonConnectionPort";
import type { Database } from "@factory/db";

export function createDaemonRegistry(database?: Database): DaemonRegistryPort {
  return new DrizzleDaemonRegistryAdapter(database ?? createDatabaseConnection(process.env.DATABASE_URL ?? ""));
}

export function buildDaemonConnectionModule(
  registry: DaemonRegistryPort = createDaemonRegistry(),
  presence?: DaemonPresencePort,
  disconnection?: DaemonDisconnectionPort
) {
  const presenceOrOffline = presence ?? { isDaemonConnected: () => false };
  const disconnectionOrNoop = disconnection ?? { disconnectDaemon: () => {} };
  return {
    registry,
    presence: presenceOrOffline,
    disconnection: disconnectionOrNoop,
  };
}
