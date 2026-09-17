import { canApproveDeviceAuthorization, normalizeUserCode } from "@factory/shared-domain";
import type { DaemonCredentialIssuerPort, DeviceAuthorizationStorePort } from "../../domain/DeviceAuthorizationPort";
import type { Result, DomainError, DaemonId } from "@factory/shared-domain";

export async function approveDeviceAuthorization(
  store: DeviceAuthorizationStorePort,
  issuer: DaemonCredentialIssuerPort,
  enteredUserCode: string,
  nowMs: number = Date.now()
): Promise<Result<{ daemonId: DaemonId }, DomainError>> {
  const record = await store.findByUserCode(normalizeUserCode(enteredUserCode));
  if (!record) return { ok: false, error: { code: "UNKNOWN_USER_CODE", message: "User code not found." } };
  if (!canApproveDeviceAuthorization(record.status, record.userCode, enteredUserCode, nowMs, record.expiresAtMs)) {
    return { ok: false, error: { code: "INVALID_USER_CODE", message: "User code is expired, already used, or does not match." } };
  }
  const credentials = await issuer.issueDaemonCredentials(record.machineName, record.requestedDaemonId);
  await store.updateAuthorization({ ...record, status: "approved", daemonId: credentials.daemonId, authToken: credentials.authToken });
  return { ok: true, value: { daemonId: credentials.daemonId } };
}
