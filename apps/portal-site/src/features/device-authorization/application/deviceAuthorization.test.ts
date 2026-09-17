import { describe, expect, test } from "bun:test";
import { approveDeviceAuthorization } from "./approveDeviceAuthorization";
import { denyDeviceAuthorization } from "./denyDeviceAuthorization";
import type { DeviceAuthorizationPort } from "../domain/DeviceAuthorizationPort";

const stubAuthorizations: DeviceAuthorizationPort = {
  approveDeviceAuthorization: async () => ({ daemonId: "daemon-1" }),
  denyDeviceAuthorization: async () => ({ denied: true }),
};

describe("device authorization use cases", () => {
  test("approves a well-formed user code", async () => {
    await expect(approveDeviceAuthorization(stubAuthorizations, "ABCD-2345")).resolves.toEqual({ daemonId: "daemon-1" });
  });

  test("rejects a malformed code before calling the API", async () => {
    await expect(approveDeviceAuthorization(stubAuthorizations, "nope")).rejects.toThrow("8-character code");
    await expect(denyDeviceAuthorization(stubAuthorizations, "nope")).rejects.toThrow("8-character code");
  });

  test("denies a well-formed user code", async () => {
    await expect(denyDeviceAuthorization(stubAuthorizations, "ABCD2345")).resolves.toEqual({ denied: true });
  });
});
