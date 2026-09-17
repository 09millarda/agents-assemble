import type { DaemonSummary } from "@factory/shared-domain";

export interface DaemonRegistryPort {
  listDaemons(): Promise<DaemonSummary[]>;
  deregisterDaemon(daemonId: string): Promise<void>;
}
