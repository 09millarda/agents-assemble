import type { DaemonConfiguration, DaemonDetails } from "@factory/shared-domain";

export interface DaemonDetailsPort {
  getDaemon(daemonId: string): Promise<DaemonDetails>;
  saveDaemonConfiguration(
    daemonId: string,
    configuration: DaemonConfiguration,
  ): Promise<DaemonDetails>;
  buildDaemonLogStreamUrl(daemonId: string): string;
}
