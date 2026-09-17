import type { HarnessCapability } from "@factory/workflow";

export interface DaemonCapabilityPort {
  getCapabilities(daemonId: string): HarnessCapability[];
}
