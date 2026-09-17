import { describe, expect, test } from "bun:test";
import {
  ApproveDeviceAuthorizationBodySchema,
  DeviceTokenBodySchema,
  RequestDeviceAuthorizationBodySchema,
} from "./deviceAuthorizationDto";

describe("device authorization DTOs", () => {
  test("rejects a blank machine name", () => {
    expect(RequestDeviceAuthorizationBodySchema.safeParse({ machineName: "  " }).success).toBe(false);
  });

  test("accepts a missing machine name", () => {
    expect(RequestDeviceAuthorizationBodySchema.parse({}).machineName).toBeUndefined();
  });

  test("rejects a malformed user code", () => {
    expect(ApproveDeviceAuthorizationBodySchema.safeParse({ user_code: "NOPE" }).success).toBe(false);
    expect(ApproveDeviceAuthorizationBodySchema.safeParse({ user_code: "ABCD-2345" }).success).toBe(true);
  });

  test("rejects a missing device code", () => {
    expect(DeviceTokenBodySchema.safeParse({}).success).toBe(false);
  });
});
