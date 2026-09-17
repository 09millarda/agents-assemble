import type {
  DaemonConfiguration,
  DaemonDetails,
  DomainError,
  Result,
} from "@factory/shared-domain";
import type { StoredCredentials } from "../../device-auth/infrastructure/credentialStore";

export interface DaemonConfigurationTarget {
  daemonId: string;
  factoryApiUrl: string;
}

export interface DaemonConfigurationChanges {
  displayName?: string;
  maxParallelHarnesses?: number;
  location?: string;
  deviceLabel?: string;
  purpose?: string;
  ownerTeam?: string;
  tags?: string[];
  notes?: string;
  clearLocation?: boolean;
  clearDeviceLabel?: boolean;
  clearPurpose?: boolean;
  clearOwnerTeam?: boolean;
  clearTags?: boolean;
  clearNotes?: boolean;
}

export function resolveDaemonConfigurationTarget(
  stored: StoredCredentials | null,
  explicitDaemonId?: string,
): Result<DaemonConfigurationTarget, DomainError> {
  if (!stored) {
    return {
      ok: false,
      error: {
        code: "NOT_LOGGED_IN",
        message: "Not logged in — run cli auth login first.",
      },
    };
  }
  return {
    ok: true,
    value: {
      daemonId: explicitDaemonId ?? stored.daemonId,
      factoryApiUrl: stored.factoryApiUrl.replace(/\/+$/, ""),
    },
  };
}

export function mergeDaemonConfiguration(
  current: DaemonConfiguration,
  changes: DaemonConfigurationChanges,
): DaemonConfiguration {
  return {
    displayName: changes.displayName ?? current.displayName,
    maxParallelHarnesses:
      changes.maxParallelHarnesses ?? current.maxParallelHarnesses,
    location: changes.clearLocation ? "" : changes.location ?? current.location,
    deviceLabel: changes.clearDeviceLabel
      ? ""
      : changes.deviceLabel ?? current.deviceLabel,
    purpose: changes.clearPurpose ? "" : changes.purpose ?? current.purpose,
    ownerTeam: changes.clearOwnerTeam
      ? ""
      : changes.ownerTeam ?? current.ownerTeam,
    tags: changes.clearTags ? [] : changes.tags ?? current.tags,
    notes: changes.clearNotes ? "" : changes.notes ?? current.notes,
  };
}

export async function getDaemonConfiguration(
  target: DaemonConfigurationTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<DaemonDetails, DomainError>> {
  const response = await fetchImpl(
    `${target.factoryApiUrl}/v1/daemons/${encodeURIComponent(target.daemonId)}`,
  );
  if (response.ok) return { ok: true, value: await response.json() as DaemonDetails };
  return {
    ok: false,
    error: {
      code: response.status === 404 ? "DAEMON_NOT_FOUND" : "DAEMON_CONFIGURATION_READ_FAILED",
      message: response.status === 404 ? "Daemon not found." : "Failed to read daemon configuration.",
    },
  };
}

export async function setDaemonConfiguration(
  target: DaemonConfigurationTarget,
  changes: DaemonConfigurationChanges,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<DaemonDetails, DomainError>> {
  const current = await getDaemonConfiguration(target, fetchImpl);
  if (!current.ok) return current;
  const configuration = mergeDaemonConfiguration(
    current.value.configuration.desired,
    changes,
  );
  const response = await fetchImpl(
    `${target.factoryApiUrl}/v1/daemons/${encodeURIComponent(target.daemonId)}/configuration`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(configuration),
    },
  );
  if (response.ok) return { ok: true, value: await response.json() as DaemonDetails };
  return {
    ok: false,
    error: {
      code: response.status === 404 ? "DAEMON_NOT_FOUND" : "DAEMON_CONFIGURATION_SAVE_FAILED",
      message: response.status === 404 ? "Daemon not found." : "Failed to save daemon configuration.",
    },
  };
}

export function formatDaemonConfiguration(details: DaemonDetails): string {
  return JSON.stringify(details.configuration, null, 2);
}
