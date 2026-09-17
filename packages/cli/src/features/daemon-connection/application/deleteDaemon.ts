import type { DaemonId, DomainError, Result } from "@factory/shared-domain";
import type { StoredCredentials } from "../../device-auth/infrastructure/credentialStore";

export type FetchImpl = typeof fetch;

export function resolveDaemonDeletionTarget(
  stored: StoredCredentials | null,
  explicitDaemonId: string | undefined,
  explicitApiUrl: string | undefined
): Result<{ daemonId: DaemonId; factoryApiUrl: string }, DomainError> {
  const daemonId = explicitDaemonId ?? stored?.daemonId;
  if (!daemonId) {
    return { ok: false, error: { code: "NOT_LOGGED_IN", message: "Not logged in — no daemon identity to delete." } };
  }
  const raw = explicitApiUrl ?? stored?.factoryApiUrl ?? process.env.FACTORY_API_URL ?? "http://localhost:3001";
  return { ok: true, value: { daemonId, factoryApiUrl: raw.replace(/\/+$/, "") } };
}

export function shouldClearLocalCredentials(stored: StoredCredentials | null, deletedDaemonId: DaemonId): boolean {
  return stored !== null && stored.daemonId === deletedDaemonId;
}

export async function deleteDaemonRegistration(
  factoryApiUrl: string,
  daemonId: DaemonId,
  fetchImpl: FetchImpl = fetch
): Promise<Result<{ daemonId: DaemonId }, DomainError>> {
  const response = await fetchImpl(`${factoryApiUrl}/v1/daemons/${encodeURIComponent(daemonId)}/deregister`, {
    method: "POST",
  });
  if (response.ok) return { ok: true, value: { daemonId } };
  if (response.status === 404) return { ok: false, error: { code: "DAEMON_NOT_FOUND", message: "Daemon not found." } };
  if (response.status === 410) {
    return { ok: false, error: { code: "DAEMON_ALREADY_DEREGISTERED", message: "Daemon is already deregistered." } };
  }
  return { ok: false, error: { code: "DEREGISTER_FAILED", message: "Failed to deregister daemon." } };
}
