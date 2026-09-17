import { describe, expect, test } from "bun:test";
import { toDeviceAuthorizationRecord } from "./DrizzleDeviceAuthorizationAdapter";

describe("toDeviceAuthorizationRecord", () => {
  test("maps a persistence row to the domain with millisecond timestamps", () => {
    const record = toDeviceAuthorizationRecord({
      deviceCode: "device-code-1",
      userCode: "ABCD-2345",
      status: "pending",
      expiresAt: new Date(1_600_000),
      machineName: "workstation",
      pollIntervalSeconds: 5,
      lastPolledAt: new Date(1_000_000),
      daemonId: null,
      authToken: null,
      requestedDaemonId: null,
    });

    expect(record).toEqual({
      deviceCode: "device-code-1",
      userCode: "ABCD-2345",
      status: "pending",
      expiresAtMs: 1_600_000,
      machineName: "workstation",
      pollIntervalSeconds: 5,
      lastPolledAtMs: 1_000_000,
      daemonId: null,
      authToken: null,
      requestedDaemonId: null,
    });
  });

  test("maps a missing poll timestamp to zero", () => {
    const record = toDeviceAuthorizationRecord({
      deviceCode: "device-code-2",
      userCode: "WXYZ-6789",
      status: "pending",
      expiresAt: new Date(1_600_000),
      machineName: "laptop",
      pollIntervalSeconds: 5,
      lastPolledAt: null,
      daemonId: null,
      authToken: null,
      requestedDaemonId: null,
    });

    expect(record.lastPolledAtMs).toBe(0);
  });
});
