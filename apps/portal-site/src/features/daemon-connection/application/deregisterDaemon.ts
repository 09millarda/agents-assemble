import type { DaemonRegistryPort } from "../domain/DaemonRegistryPort";

export async function deregisterDaemon(registry: DaemonRegistryPort, daemonId: string): Promise<void> {
  await registry.deregisterDaemon(daemonId);
}
