import { randomBytes } from "node:crypto";
import { DEVICE_AUTHORIZATION_LIFETIME_SECONDS } from "@factory/shared-domain";
import type { DeviceAuthorizationStorePort } from "../../domain/DeviceAuthorizationPort";

const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const POLL_INTERVAL_SECONDS = 5;

export function issueUserCode(): string {
  const bytes = randomBytes(8);
  let raw = "";
  for (const byte of bytes) raw += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export function buildVerificationUri(portalBase: string, userCode: string): string {
  const base = portalBase.replace(/\/+$/, "");
  return `${base}/#/device?code=${encodeURIComponent(userCode)}`;
}

export async function requestDeviceAuthorization(
  store: DeviceAuthorizationStorePort,
  input: { machineName: string; verificationUri: string; existingDaemonId?: string | null; nowMs?: number }
): Promise<DeviceAuthorizationResponse> {
  const nowMs = input.nowMs ?? Date.now();
  const deviceCode = randomBytes(32).toString("hex");
  const userCode = issueUserCode();
  await store.saveAuthorization({
    deviceCode,
    userCode,
    status: "pending",
    expiresAtMs: nowMs + DEVICE_AUTHORIZATION_LIFETIME_SECONDS * 1000,
    machineName: input.machineName,
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    lastPolledAtMs: 0,
    daemonId: null,
    authToken: null,
    requestedDaemonId: input.existingDaemonId ?? null,
  });
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: buildVerificationUri(input.verificationUri, userCode),
    expires_in: DEVICE_AUTHORIZATION_LIFETIME_SECONDS,
    interval: POLL_INTERVAL_SECONDS,
  };
}
