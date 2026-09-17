import type { DeviceAuthorizationStatus, Result, DomainError, DaemonId } from "@factory/shared-domain";

export interface DeviceAuthorizationRecord {
  deviceCode: string;
  userCode: string;
  status: DeviceAuthorizationStatus;
  expiresAtMs: number;
  machineName: string;
  pollIntervalSeconds: number;
  lastPolledAtMs: number;
  daemonId: DaemonId | null;
  authToken: string | null;
  requestedDaemonId: DaemonId | null;
}

export interface DeviceAuthorizationStorePort {
  saveAuthorization(record: DeviceAuthorizationRecord): Promise<void>;
  findByDeviceCode(deviceCode: string): Promise<DeviceAuthorizationRecord | null>;
  findByUserCode(userCode: string): Promise<DeviceAuthorizationRecord | null>;
  updateAuthorization(record: DeviceAuthorizationRecord): Promise<void>;
}

export interface DaemonCredentialIssuerPort {
  issueDaemonCredentials(
    machineName: string,
    existingDaemonId?: DaemonId | null
  ): Promise<{ daemonId: DaemonId; authToken: string; authTokenHash: string }>;
}
