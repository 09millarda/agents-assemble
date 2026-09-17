import { isUserCodeValid } from "@factory/shared-domain";
import type { DeviceAuthorizationPort } from "../domain/DeviceAuthorizationPort";

export async function denyDeviceAuthorization(
  authorizations: DeviceAuthorizationPort,
  userCode: string
): Promise<{ denied: true }> {
  if (!isUserCodeValid(userCode)) throw new Error("Enter the 8-character code shown by cli.");
  return authorizations.denyDeviceAuthorization(userCode);
}
