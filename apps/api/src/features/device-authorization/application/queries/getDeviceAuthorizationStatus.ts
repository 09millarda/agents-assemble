import { isDeviceAuthorizationExpired } from "@factory/shared-domain";
import type { DeviceAuthorizationStatus, Result, DomainError } from "@factory/shared-domain";
import type { DeviceAuthorizationStorePort } from "../../domain/DeviceAuthorizationPort";

export interface DeviceAuthorizationStatusView {
  deviceCode: string;
  status: DeviceAuthorizationStatus;
  expiresAtMs: number;
}

function isGrantExpired(expiresAtMs: number, nowMs: number): boolean {
  return isDeviceAuthorizationExpired(expiresAtMs, nowMs);
}

export async function getDeviceAuthorizationStatus(
  store: DeviceAuthorizationStorePort,
  deviceCode: string,
  nowMs: number = Date.now()
): Promise<Result<DeviceAuthorizationStatusView, DomainError>> {
  const record = await store.findByDeviceCode(deviceCode);
  if (!record) return { ok: false, error: { code: "UNKNOWN_DEVICE_CODE", message: "Device authorization not found." } };
  return {
    ok: true,
    value: {
      deviceCode: record.deviceCode,
      status: isGrantExpired(record.expiresAtMs, nowMs) ? "expired" : record.status,
      expiresAtMs: record.expiresAtMs,
    },
  };
}
