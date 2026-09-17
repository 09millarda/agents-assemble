import { canPollDeviceAuthorization, isDeviceAuthorizationExpired } from "@factory/shared-domain";
import type { DeviceTokenErrorCode } from "@factory/shared-domain";
import type { DeviceAuthorizationStorePort } from "../../domain/DeviceAuthorizationPort";
import type { Result, DomainError, DaemonId } from "@factory/shared-domain";

function tokenError(code: DeviceTokenErrorCode, message: string): Result<{ daemonId: DaemonId; authToken: string }, DomainError> {
  return { ok: false, error: { code, message } };
}

export async function pollForDeviceToken(
  store: DeviceAuthorizationStorePort,
  deviceCode: string,
  nowMs: number = Date.now()
): Promise<Result<{ daemonId: DaemonId; authToken: string }, DomainError>> {
  const record = await store.findByDeviceCode(deviceCode);
  if (!record) return tokenError("expired_token", "Device authorization not found or expired.");
  if (record.status === "denied") return tokenError("access_denied", "Device authorization was denied.");
  if (record.status === "expired" || isDeviceAuthorizationExpired(record.expiresAtMs, nowMs)) {
    await store.updateAuthorization({ ...record, status: "expired" });
    return tokenError("expired_token", "Device authorization expired.");
  }
  if (record.status === "approved") {
    if (!record.daemonId || !record.authToken) return tokenError("expired_token", "Device credentials were already issued.");
    const credentials = { daemonId: record.daemonId, authToken: record.authToken };
    await store.updateAuthorization({ ...record, authToken: null });
    return { ok: true, value: credentials };
  }
  if (!canPollDeviceAuthorization(record.status, nowMs, record.expiresAtMs, record.lastPolledAtMs, record.pollIntervalSeconds * 1000)) {
    await store.updateAuthorization({ ...record, pollIntervalSeconds: record.pollIntervalSeconds + 5 });
    return tokenError("slow_down", "Polling too fast; back off before retrying.");
  }
  await store.updateAuthorization({ ...record, lastPolledAtMs: nowMs });
  return tokenError("authorization_pending", "Waiting for user approval.");
}
