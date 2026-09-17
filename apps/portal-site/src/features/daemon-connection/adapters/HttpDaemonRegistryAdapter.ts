import type {
  DaemonConfiguration,
  DaemonDetails,
  DaemonSummary,
} from "@factory/shared-domain";
import type { DaemonRegistryPort } from "../domain/DaemonRegistryPort";
import type { DaemonDetailsPort } from "../domain/DaemonDetailsPort";

const PAGE_LIMIT = 100;

interface DaemonPage {
  data: DaemonSummary[];
  pagination: { nextCursor: string | null; limit: number };
}

function resolveFactoryApiUrl(): string {
  return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_FACTORY_API_URL ?? "http://localhost:3001";
}

function isDaemonPage(body: unknown): body is DaemonPage {
  if (typeof body !== "object" || body === null) return false;
  const page = body as Record<string, unknown>;
  if (!Array.isArray(page.data)) return false;
  const pagination = page.pagination as Record<string, unknown> | undefined;
  return (
    typeof pagination === "object" &&
    pagination !== null &&
    (typeof pagination.nextCursor === "string" || pagination.nextCursor === null) &&
    typeof pagination.limit === "number"
  );
}

export class HttpDaemonRegistryAdapter implements DaemonRegistryPort, DaemonDetailsPort {
  constructor(private readonly baseUrl: string = resolveFactoryApiUrl()) {}

  async listDaemons(): Promise<DaemonSummary[]> {
    const collected: DaemonSummary[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await this.fetchPage(cursor);
      collected.push(...page.data);
      if (page.pagination.nextCursor === null) return collected;
      cursor = page.pagination.nextCursor;
    }
  }

  async deregisterDaemon(daemonId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}/v1/daemons/${encodeURIComponent(daemonId)}/deregister`,
      { method: "POST" }
    );
    if (response.ok || response.status === 404 || response.status === 410) return;
    throw new Error("Failed to remove daemon.");
  }

  async getDaemon(daemonId: string): Promise<DaemonDetails> {
    const response = await fetch(
      `${this.apiBaseUrl()}/v1/daemons/${encodeURIComponent(daemonId)}`,
    );
    if (!response.ok) throw new Error("Failed to load daemon details.");
    return await response.json() as DaemonDetails;
  }

  async saveDaemonConfiguration(
    daemonId: string,
    configuration: DaemonConfiguration,
  ): Promise<DaemonDetails> {
    const response = await fetch(
      `${this.apiBaseUrl()}/v1/daemons/${encodeURIComponent(daemonId)}/configuration`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(configuration),
      },
    );
    if (!response.ok) throw new Error("Failed to save daemon configuration.");
    return await response.json() as DaemonDetails;
  }

  buildDaemonLogStreamUrl(daemonId: string): string {
    return `${this.apiBaseUrl()}/v1/daemons/${encodeURIComponent(daemonId)}/logs/stream?acknowledgeSensitiveData=true`;
  }

  private async fetchPage(cursor: string | null): Promise<DaemonPage> {
    const query = cursor ? `?limit=${PAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}` : `?limit=${PAGE_LIMIT}`;
    const response = await fetch(`${this.apiBaseUrl()}/v1/daemons${query}`);
    if (!response.ok) throw new Error("Failed to load daemons.");
    const body: unknown = await response.json();
    if (!isDaemonPage(body)) throw new Error("Failed to load daemons.");
    return body;
  }

  private apiBaseUrl(): string {
    return this.baseUrl.replace(/\/+$/, "");
  }
}
