import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

export const recordSchema = z.record(z.string(), z.unknown());
export type RecordData = z.infer<typeof recordSchema>;
export type Credentials = { token: string; organizationId: string };
export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string().optional(),
  retry: z.enum(["never", "same_operation", "reconcile"]).optional(),
  currentVersion: z.number().optional(),
});
export class ApiError extends Error {
  constructor(public readonly detail: z.infer<typeof errorSchema>) {
    super(detail.message);
  }
}
export const asRecord = (value: unknown): RecordData => recordSchema.parse(value);
export function resource(value: unknown): RecordData {
  const item = asRecord(value);
  if (typeof item.id === "string" && recordSchema.safeParse(item.data).success)
    return {
      ...asRecord(item.data),
      id: item.id,
      version: item.version,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  return item;
}
export const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
export const rows = (value: unknown, key?: string): RecordData[] => {
  const candidate = key && value && typeof value === "object" ? asRecord(value)[key] : value;
  return z.array(recordSchema).parse(candidate);
};

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  credentials?: Credentials,
  options: { method?: string; body?: unknown; key?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (credentials?.token) headers.set("Authorization", `Bearer ${credentials.token}`);
  if (credentials?.organizationId) headers.set("X-Organization-Id", credentials.organizationId);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.key) headers.set("Idempotency-Key", options.key);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError({
      code: "connection_lost",
      message: options.method
        ? "The connection ended before the operation was confirmed. Reconnect and reconcile before submitting different work."
        : "The service could not be reached. Check your connection and try again.",
      retry: options.method ? "same_operation" : "never",
    });
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ApiError({
      code: "invalid_response",
      message:
        "The service returned an unreadable response. No successful outcome has been confirmed.",
      retry: "reconcile",
    });
  }
  if (!response.ok) {
    const object = recordSchema.safeParse(value);
    const parsed = errorSchema.safeParse(
      object.success && object.data.error ? object.data.error : value,
    );
    throw new ApiError(
      parsed.success
        ? parsed.data
        : {
            code: `http_${response.status}`,
            message:
              "The service rejected this request. Refresh the current record before trying again.",
            retry: "never",
          },
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiError({
      code: "invalid_response",
      message:
        "The service response did not match the supported contract. No successful outcome has been confirmed.",
      retry: "reconcile",
    });
  return parsed.data;
}

export function useResource(path: string | null, credentials?: Credentials) {
  const token = credentials?.token ?? "";
  const organizationId = credentials?.organizationId ?? "";
  const key = `${path}:${credentials?.token ?? ""}:${credentials?.organizationId ?? ""}`;
  const [state, setState] = useState<{
    key: string;
    data?: RecordData;
    error?: Error;
    loading: boolean;
  }>({ key, loading: true });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit manual refresh signal for the same resource.
  useEffect(() => {
    const controller = new AbortController();
    if (!path) {
      setState({ key, loading: false });
      return;
    }
    setState((current) => ({
      key,
      data: current.key === key ? current.data : undefined,
      loading: true,
    }));
    request(path, recordSchema, { token, organizationId }, { signal: controller.signal })
      .then((data) => setState({ key, data: resource(data), loading: false }))
      .catch((error: Error) => {
        if (!controller.signal.aborted) setState({ key, error, loading: false });
      });
    return () => controller.abort();
  }, [key, revision, path, token, organizationId]);
  return {
    ...(state.key === key ? state : { loading: true, data: undefined, error: undefined }),
    refresh,
  };
}

export function useCommand(credentials?: Credentials) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [result, setResult] = useState<RecordData>();
  const operation = useRef<{ identity: string; key: string } | undefined>(undefined);
  async function run(path: string, body: unknown, method = "POST") {
    const identity = JSON.stringify({
      path,
      body,
      method,
      organizationId: credentials?.organizationId,
    });
    if (!operation.current || operation.current.identity !== identity)
      operation.current = { identity, key: crypto.randomUUID() };
    setPending(true);
    setError(undefined);
    setResult(undefined);
    try {
      const value = await request(path, recordSchema, credentials, {
        method,
        body,
        key: operation.current.key,
      });
      setResult(value);
      operation.current = undefined;
      return value;
    } catch (reason) {
      const failure =
        reason instanceof Error ? reason : new Error("The operation could not be confirmed.");
      setError(failure);
      throw failure;
    } finally {
      setPending(false);
    }
  }
  return { run, pending, error, result };
}
