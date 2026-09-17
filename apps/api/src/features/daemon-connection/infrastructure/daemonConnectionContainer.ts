import { DrizzleDaemonRegistryAdapter } from "../adapters/DrizzleDaemonRegistryAdapter";
import { createDatabaseConnection } from "@factory/db";
import type { DaemonDisconnectionPort, DaemonPresencePort, DaemonRegistryPort } from "../domain/DaemonConnectionPort";
import type {
  DaemonConfigurationPort,
  DaemonConfigurationStatePort,
  DaemonQueryPort,
  DaemonRuntimeFactsPort,
} from "../domain/DaemonConfigurationPort";
import type { Database } from "@factory/db";

export type CompleteDaemonRegistry = DaemonRegistryPort &
  DaemonQueryPort &
  DaemonConfigurationPort &
  DaemonConfigurationStatePort &
  DaemonRuntimeFactsPort;

export function createDaemonRegistry(database?: Database): CompleteDaemonRegistry {
  return new DrizzleDaemonRegistryAdapter(database ?? createDatabaseConnection(process.env.DATABASE_URL ?? ""));
}

export function buildDaemonConnectionModule(
  registry: CompleteDaemonRegistry = createDaemonRegistry(),
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
