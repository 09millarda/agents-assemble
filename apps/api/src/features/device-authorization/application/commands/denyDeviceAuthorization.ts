import { isDeviceAuthorizationExpired, normalizeUserCode } from "@factory/shared-domain";
import type { DeviceAuthorizationStorePort } from "../../domain/DeviceAuthorizationPort";
import type { Result, DomainError } from "@factory/shared-domain";

export async function denyDeviceAuthorization(
  store: DeviceAuthorizationStorePort,
  enteredUserCode: string,
  nowMs: number = Date.now()
): Promise<Result<{ denied: true }, DomainError>> {
  const record = await store.findByUserCode(normalizeUserCode(enteredUserCode));
  if (!record) return { ok: false, error: { code: "UNKNOWN_USER_CODE", message: "User code not found." } };
  if (record.status !== "pending" || isDeviceAuthorizationExpired(record.expiresAtMs, nowMs)) {
    return { ok: false, error: { code: "INVALID_USER_CODE", message: "User code is expired or already used." } };
  }
  await store.updateAuthorization({ ...record, status: "denied" });
  return { ok: true, value: { denied: true } };
}
