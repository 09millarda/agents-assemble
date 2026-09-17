import type { DeviceAuthorizationPort } from "../domain/DeviceAuthorizationPort";

function resolveFactoryApiUrl(): string {
  return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_FACTORY_API_URL ?? "http://localhost:3001";
}

export class HttpDeviceAuthorizationAdapter implements DeviceAuthorizationPort {
  constructor(private readonly baseUrl: string = resolveFactoryApiUrl()) {}

  async approveDeviceAuthorization(userCode: string): Promise<{ daemonId: string }> {
    return this.post<{ daemonId: string }>("/v1/device/approve", userCode, "Approval failed.");
  }

  async denyDeviceAuthorization(userCode: string): Promise<{ denied: true }> {
    return this.post<{ denied: true }>("/v1/device/deny", userCode, "Denial failed.");
  }

  private async post<T>(path: string, userCode: string, fallbackMessage: string): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_code: userCode }),
    });
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    if (!response.ok) throw new Error(body?.detail ?? fallbackMessage);
    return body as T;
  }
}
