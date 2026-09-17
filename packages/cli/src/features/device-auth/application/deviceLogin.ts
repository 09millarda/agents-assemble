import type { StoredCredentials } from "../infrastructure/credentialStore";

export interface DeviceFlowAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type FetchImpl = typeof fetch;

export function resolveFactoryApiUrl(explicitApiUrl?: string): string {
  const raw = explicitApiUrl ?? process.env.FACTORY_API_URL ?? "http://localhost:3001";
  return raw.replace(/\/+$/, "");
}

export async function requestDeviceLogin(
  factoryApiUrl: string,
  machineName: string,
  fetchImpl: FetchImpl = fetch,
  existingDaemonId?: string | null
): Promise<DeviceFlowAuthorization> {
  const response = await fetchImpl(`${factoryApiUrl}/v1/device/authorizations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(existingDaemonId ? { machineName, daemon_id: existingDaemonId } : { machineName }),
  });
  if (!response.ok) throw new Error(`Authorization request rejected: ${await response.text()}`);
  return (await response.json()) as DeviceFlowAuthorization;
}

export type DeviceLoginOutcome =
  | { ok: true; credentials: StoredCredentials }
  | { ok: false; error: { code: string; message: string } };

export interface PollDependencies {
  fetchImpl?: FetchImpl;
  sleepMs?: (delayMs: number) => Promise<void>;
  nowMs?: () => number;
}

const defaultSleep = (delayMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function pollForDeviceCredentials(
  factoryApiUrl: string,
  authorization: DeviceFlowAuthorization,
  dependencies: PollDependencies = {}
): Promise<DeviceLoginOutcome> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleepMs = dependencies.sleepMs ?? defaultSleep;
  const nowMs = dependencies.nowMs ?? Date.now;
  const deadlineMs = nowMs() + authorization.expires_in * 1000;
  let intervalSeconds = authorization.interval;
  for (;;) {
    if (nowMs() >= deadlineMs) {
      return { ok: false, error: { code: "expired_token", message: "Device authorization expired before approval." } };
    }
    await sleepMs(intervalSeconds * 1000);
    const response = await fetchImpl(`${factoryApiUrl}/v1/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: authorization.device_code }),
    });
    const body = (await response.json()) as { status?: string; code?: string; detail?: string; daemonId?: string; authToken?: string };
    if (response.ok && body.status === "approved" && body.daemonId && body.authToken) {
      return { ok: true, credentials: { daemonId: body.daemonId, authToken: body.authToken, factoryApiUrl } };
    }
    if (response.status === 403) {
      return { ok: false, error: { code: "access_denied", message: body.detail ?? "Device authorization was denied." } };
    }
    if (response.status === 410) {
      return { ok: false, error: { code: "expired_token", message: body.detail ?? "Device authorization expired." } };
    }
    if (response.status === 429) {
      intervalSeconds += 5;
    }
  }
}
