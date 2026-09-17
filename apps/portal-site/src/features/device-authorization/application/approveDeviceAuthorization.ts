import { isUserCodeValid } from "@factory/shared-domain";
import type { DeviceAuthorizationPort } from "../domain/DeviceAuthorizationPort";

export async function approveDeviceAuthorization(
  authorizations: DeviceAuthorizationPort,
  userCode: string
): Promise<{ daemonId: string }> {
  if (!isUserCodeValid(userCode)) throw new Error("Enter the 8-character code shown by cli.");
  return authorizations.approveDeviceAuthorization(userCode);
}
