import type { DaemonId, DaemonSummary, DomainError, Result } from "@factory/shared-domain";
import type { DaemonDisconnectionPort, DaemonRegistryPort } from "../../domain/DaemonConnectionPort";

export async function deregisterDaemon(
  registry: DaemonRegistryPort,
  disconnection: DaemonDisconnectionPort,
  daemonId: DaemonId
): Promise<Result<DaemonSummary, DomainError>> {
  const outcome = await registry.deregisterDaemon(daemonId);
  if (outcome === "not-found") {
    return { ok: false, error: { code: "DAEMON_NOT_FOUND", message: "Daemon not found." } };
  }
  if (outcome === "already-deregistered") {
    return { ok: false, error: { code: "DAEMON_ALREADY_DEREGISTERED", message: "Daemon is already deregistered." } };
  }
  disconnection.disconnectDaemon(daemonId);
  return { ok: true, value: { daemonId, machineName: "", status: "deregistered" } };
}
