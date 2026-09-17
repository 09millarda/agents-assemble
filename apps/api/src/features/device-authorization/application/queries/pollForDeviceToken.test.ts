import { describe, expect, test } from "bun:test";
import { pollForDeviceToken } from "./pollForDeviceToken";
import type { DeviceAuthorizationRecord, DeviceAuthorizationStorePort } from "../../domain/DeviceAuthorizationPort";

function pendingRecord(overrides: Partial<DeviceAuthorizationRecord> = {}): DeviceAuthorizationRecord {
  return {
    deviceCode: "device-code-1",
    userCode: "ABCD-2345",
    status: "pending",
    expiresAtMs: 600_000,
    machineName: "workstation",
    pollIntervalSeconds: 5,
    lastPolledAtMs: 0,
    daemonId: null,
    authToken: null,
    requestedDaemonId: null,
    ...overrides,
  };
}

function stubStore(record: DeviceAuthorizationRecord | null): DeviceAuthorizationStorePort & { updated: DeviceAuthorizationRecord[] } {
  const stub: DeviceAuthorizationStorePort & { updated: DeviceAuthorizationRecord[] } = {
    updated: [],
    saveAuthorization: async () => {},
    findByDeviceCode: async () => stub.updated.at(-1) ?? record,
    findByUserCode: async () => null,
    updateAuthorization: async (next) => { stub.updated.push(next); },
  };
  return stub;
}

describe("pollForDeviceToken", () => {
  test("pending grant waits without credentials", async () => {
    const result = await pollForDeviceToken(stubStore(pendingRecord()), "device-code-1", 6000);

    expect(result).toEqual({ ok: false as const, error: { code: "authorization_pending", message: expect.any(String) as string } });
  });

  test("fast polling asks the client to slow down", async () => {
    const result = await pollForDeviceToken(stubStore(pendingRecord()), "device-code-1", 1000);

    expect(result).toEqual({ ok: false as const, error: { code: "slow_down", message: expect.any(String) as string } });
  });

  test("approved grant yields single-use credentials", async () => {
    const store = stubStore(pendingRecord({ status: "approved", daemonId: "daemon-1", authToken: "token-1" }));
    const first = await pollForDeviceToken(store, "device-code-1", 6000);

    expect(first).toEqual({ ok: true as const, value: { daemonId: "daemon-1", authToken: "token-1" } });
    expect(store.updated[0]?.authToken).toBeNull();

    const second = await pollForDeviceToken(store, "device-code-1", 6000);
    expect(second).toEqual({ ok: false as const, error: { code: "expired_token", message: expect.any(String) as string } });
  });

  test("denied grant maps to access_denied", async () => {
    const result = await pollForDeviceToken(stubStore(pendingRecord({ status: "denied" })), "device-code-1", 6000);

    expect(result).toEqual({ ok: false as const, error: { code: "access_denied", message: expect.any(String) as string } });
  });

  test("expired grant maps to expired_token", async () => {
    const result = await pollForDeviceToken(stubStore(pendingRecord()), "device-code-1", 700_000);

    expect(result).toEqual({ ok: false as const, error: { code: "expired_token", message: expect.any(String) as string } });
  });

  test("unknown device code maps to expired_token", async () => {
    const result = await pollForDeviceToken(stubStore(null), "nope", 6000);

    expect(result).toEqual({ ok: false as const, error: { code: "expired_token", message: expect.any(String) as string } });
  });
});
