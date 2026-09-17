import type {
  DaemonConfiguration,
  DaemonDetails,
  DaemonId,
  DaemonRuntimeFacts,
  DaemonTelemetry,
} from "@factory/shared-domain";

export interface DaemonQueryPort {
  findDaemon(daemonId: DaemonId): Promise<DaemonDetails | null>;
}

export interface DaemonConfigurationPort {
  saveDesiredConfiguration(
    daemonId: DaemonId,
    configuration: DaemonConfiguration,
  ): Promise<DaemonDetails | null>;
}

export interface DaemonConfigurationStatePort {
  recordAppliedConfiguration(
    daemonId: DaemonId,
    revision: number,
  ): Promise<DaemonDetails | null>;
  recordRejectedConfiguration(
    daemonId: DaemonId,
    revision: number,
    reason: string,
  ): Promise<DaemonDetails | null>;
}

export interface DaemonRuntimeFactsPort {
  recordRuntimeFacts(
    daemonId: DaemonId,
    facts: DaemonRuntimeFacts,
  ): Promise<DaemonDetails | null>;
}

export interface DaemonConfigurationDeliveryPort {
  sendConfiguration(
    daemonId: DaemonId,
    revision: number,
    configuration: DaemonConfiguration,
  ): boolean;
}

export interface DaemonTelemetryPort {
  getDaemonTelemetry(daemonId: DaemonId): DaemonTelemetry | null;
}
