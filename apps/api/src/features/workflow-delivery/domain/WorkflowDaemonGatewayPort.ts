import type { HarnessCapability, WorkflowDaemonFact } from "@factory/workflow";
export interface WorkflowDaemonGatewayPort {
  connectDaemon(
    daemonId: string,
    capabilities: HarnessCapability[],
  ): Promise<void>;
  acceptFact(daemonId: string, fact: WorkflowDaemonFact): Promise<boolean>;
}
