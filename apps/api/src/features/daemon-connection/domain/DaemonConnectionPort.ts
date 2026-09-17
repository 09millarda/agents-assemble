import type { DaemonId, DaemonSummary } from "@factory/shared-domain";

export type DeregisterOutcome = "deregistered" | "not-found" | "already-deregistered";

export interface DaemonRegistryPort {
  issueDaemonCredentials(
    machineName: string,
    existingDaemonId?: DaemonId | null
  ): Promise<{ daemonId: DaemonId; authToken: string; authTokenHash: string }>;
  updateDaemonOnHello(daemonId: DaemonId, machineName: string): Promise<void>;
  listKnownDaemons(): Promise<DaemonId[]>;
  listDaemons(): Promise<DaemonSummary[]>;
  verifyDaemonToken(daemonId: DaemonId, authToken: string): Promise<boolean>;
  deregisterDaemon(daemonId: DaemonId): Promise<DeregisterOutcome>;
}

export interface DaemonPresencePort {
  isDaemonConnected(daemonId: DaemonId): boolean;
}

export interface DaemonDisconnectionPort {
  disconnectDaemon(daemonId: DaemonId): void;
}
