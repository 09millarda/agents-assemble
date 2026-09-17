import { describe, expect, test } from "bun:test";
import { requestDeviceAuthorization } from "./requestDeviceAuthorization";
import type { DeviceAuthorizationRecord, DeviceAuthorizationStorePort } from "../../domain/DeviceAuthorizationPort";

function stubStore(): DeviceAuthorizationStorePort & { saved: number; records: DeviceAuthorizationRecord[] } {
  const stub: DeviceAuthorizationStorePort & { saved: number; records: DeviceAuthorizationRecord[] } = {
    saved: 0,
    records: [],
    saveAuthorization: async (record) => {
      stub.saved += 1;
      stub.records.push(record);
    },
    findByDeviceCode: async () => null,
    findByUserCode: async () => null,
    updateAuthorization: async () => {},
  };
  return stub;
}

describe("requestDeviceAuthorization", () => {
  test("returns known-good device flow literals and persists the grant", async () => {
    const store = stubStore();
    const result = await requestDeviceAuthorization(store, { machineName: "workstation", verificationUri: "http://portal" });

    expect(result.device_code.length).toBeGreaterThanOrEqual(32);
    expect(result.user_code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(result.verification_uri).toBe(`http://portal/#/device?code=${encodeURIComponent(result.user_code)}`);
    expect(result.expires_in).toBe(600);
    expect(result.interval).toBe(5);
    expect(store.saved).toBe(1);
  });

  test("trims trailing slashes from the portal base", async () => {
    const store = stubStore();
    const result = await requestDeviceAuthorization(store, { machineName: "workstation", verificationUri: "http://portal///" });

    expect(result.verification_uri).toBe(`http://portal/#/device?code=${encodeURIComponent(result.user_code)}`);
  });
});

describe("stable daemon identity", () => {
  test("persists the existing daemon ID so approval reuses it", async () => {
    const store = stubStore();
    await requestDeviceAuthorization(store, { machineName: "workstation", verificationUri: "http://portal", existingDaemonId: "daemon-1" });

    expect(store.records[0]?.requestedDaemonId).toBe("daemon-1");
  });

  test("fresh logins persist no daemon ID", async () => {
    const store = stubStore();
    await requestDeviceAuthorization(store, { machineName: "workstation", verificationUri: "http://portal" });

    expect(store.records[0]?.requestedDaemonId).toBeNull();
  });
});
