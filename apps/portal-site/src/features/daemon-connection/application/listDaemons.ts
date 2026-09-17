import type { DaemonSummary } from "@factory/shared-domain";
import type { DaemonRegistryPort } from "../domain/DaemonRegistryPort";

export async function listDaemons(registry: DaemonRegistryPort): Promise<DaemonSummary[]> {
  return registry.listDaemons();
}
