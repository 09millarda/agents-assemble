export function resolveFactoryApiUrl(): string {
  return import.meta.env?.VITE_FACTORY_API_URL ?? "http://localhost:3001";
}

export class FactoryHttpClient {
  constructor(private readonly baseUrl = resolveFactoryApiUrl()) {}

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}${path}`,
      init,
    );
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as {
        detail?: string;
      } | null;
      throw new Error(
        problem?.detail ?? `Request failed (${response.status}).`,
      );
    }
    return (await response.json()) as T;
  }

  async list<T>(path: string): Promise<T[]> {
    const values: T[] = [];
    let cursor: string | null = null;
    do {
      const separator = path.includes("?") ? "&" : "?";
      const page: { data: T[]; pagination: { nextCursor: string | null } } =
        await this.request(
          `${path}${separator}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
      values.push(...page.data);
      cursor = page.pagination.nextCursor;
    } while (cursor);
    return values;
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}
