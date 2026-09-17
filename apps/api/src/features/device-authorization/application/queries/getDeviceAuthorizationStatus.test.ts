import { describe, expect, test } from "bun:test";
import { getDeviceAuthorizationStatus } from "./getDeviceAuthorizationStatus";
import type { DeviceAuthorizationRecord, DeviceAuthorizationStorePort } from "../../domain/DeviceAuthorizationPort";

const NOW_MS = 1_000_000;

function stubStore(record: DeviceAuthorizationRecord | null): DeviceAuthorizationStorePort {
  return {
    saveAuthorization: async () => {},
    findByDeviceCode: async () => record,
    findByUserCode: async () => null,
    updateAuthorization: async () => {},
  };
}

function pendingRecord(): DeviceAuthorizationRecord {
  return {
    deviceCode: "device-code-1",
    userCode: "ABCD-2345",
    status: "pending",
    expiresAtMs: NOW_MS + 600_000,
    machineName: "workstation",
    pollIntervalSeconds: 5,
    lastPolledAtMs: 0,
    daemonId: null,
    authToken: null,
    requestedDaemonId: null,
  };
}

describe("getDeviceAuthorizationStatus", () => {
  test("reports the pending grant with its expiry", async () => {
    const result = await getDeviceAuthorizationStatus(stubStore(pendingRecord()), "device-code-1", NOW_MS);

    expect(result).toEqual({
      ok: true,
      value: { deviceCode: "device-code-1", status: "pending", expiresAtMs: NOW_MS + 600_000 },
    });
  });

  test("reports an expired grant as expired", async () => {
    const result = await getDeviceAuthorizationStatus(stubStore(pendingRecord()), "device-code-1", NOW_MS + 600_001);

    expect(result).toEqual({
      ok: true,
      value: { deviceCode: "device-code-1", status: "expired", expiresAtMs: NOW_MS + 600_000 },
    });
  });

  test("fails for an unknown device code", async () => {
    const result = await getDeviceAuthorizationStatus(stubStore(null), "missing", NOW_MS);

    expect(result).toEqual({ ok: false, error: { code: "UNKNOWN_DEVICE_CODE", message: "Device authorization not found." } });
  });
});
