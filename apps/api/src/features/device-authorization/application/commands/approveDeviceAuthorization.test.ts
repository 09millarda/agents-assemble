import { describe, expect, test } from "bun:test";
import { approveDeviceAuthorization } from "./approveDeviceAuthorization";
import { denyDeviceAuthorization } from "./denyDeviceAuthorization";
import type { DaemonCredentialIssuerPort, DeviceAuthorizationRecord, DeviceAuthorizationStorePort } from "../../domain/DeviceAuthorizationPort";

function pendingRecord(): DeviceAuthorizationRecord {
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
  };
}

function stubStore(record: DeviceAuthorizationRecord | null): DeviceAuthorizationStorePort & { updated: DeviceAuthorizationRecord[] } {
  const stub: DeviceAuthorizationStorePort & { updated: DeviceAuthorizationRecord[] } = {
    updated: [],
    saveAuthorization: async () => {},
    findByDeviceCode: async () => null,
    findByUserCode: async () => record,
    updateAuthorization: async (next) => { stub.updated.push(next); },
  };
  return stub;
}

const issuer: DaemonCredentialIssuerPort = {
  issueDaemonCredentials: async (machineName) => ({ daemonId: `daemon-for-${machineName}`, authToken: "token-1", authTokenHash: "hash-1" }),
};

describe("approveDeviceAuthorization", () => {
  test("matching code mints daemon credentials", async () => {
    const store = stubStore(pendingRecord());
    const result = await approveDeviceAuthorization(store, issuer, "abcd-2345", 1000);

    expect(result).toEqual({ ok: true as const, value: { daemonId: "daemon-for-workstation" } });
    expect(store.updated[0]?.status).toBe("approved");
  });

  test("mismatched code is rejected", async () => {
    const result = await approveDeviceAuthorization(stubStore(pendingRecord()), issuer, "WXYZ-6789", 1000);

    expect(result.ok).toBe(false);
  });

  test("unknown code is rejected", async () => {
    const result = await approveDeviceAuthorization(stubStore(null), issuer, "ABCD-2345", 1000);

    expect(result.ok).toBe(false);
  });
});

describe("denyDeviceAuthorization", () => {
  test("matching code marks the grant denied", async () => {
    const store = stubStore(pendingRecord());
    const result = await denyDeviceAuthorization(store, "ABCD-2345", 1000);

    expect(result.ok).toBe(true);
    expect(store.updated[0]?.status).toBe("denied");
  });
});

describe("stable daemon identity", () => {
  test("re-login reuses the stored daemon ID and updates the machine name", async () => {
    const issued: { machineName: string; existingDaemonId?: string | null }[] = [];
    const reusingIssuer: DaemonCredentialIssuerPort = {
      issueDaemonCredentials: async (machineName, existingDaemonId) => {
        issued.push({ machineName, existingDaemonId });
        return { daemonId: existingDaemonId ?? `daemon-for-${machineName}`, authToken: "token-2", authTokenHash: "hash-2" };
      },
    };
    const store = stubStore({ ...pendingRecord(), machineName: "renamed-workstation", requestedDaemonId: "daemon-1" });
    const result = await approveDeviceAuthorization(store, reusingIssuer, "abcd-2345", 1000);

    expect(result).toEqual({ ok: true as const, value: { daemonId: "daemon-1" } });
    expect(issued).toEqual([{ machineName: "renamed-workstation", existingDaemonId: "daemon-1" }]);
    expect(store.updated[0]?.daemonId).toBe("daemon-1");
  });
});
