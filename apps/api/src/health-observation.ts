import { z } from "zod";
export const healthFailureSchema = z.enum(["timeout", "network", "body_read"]);
export type HealthFailure = z.infer<typeof healthFailureSchema>;
export interface HealthObservation {
  status: number | null;
  artifactDigest: string | null;
  truncated: boolean;
  failure: HealthFailure | null;
}
export interface HealthObservationPort {
  read(url: string): Promise<HealthObservation>;
}
/** Reads at most 64 KiB of an external response, discarding oversized content. */
export class HttpHealthObservation implements HealthObservationPort {
  private readonly timeoutMs: number;
  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = z
      .int()
      .min(1)
      .max(15000)
      .parse(options.timeoutMs ?? 15000);
  }
  async read(url: string): Promise<HealthObservation> {
    const signal = AbortSignal.timeout(this.timeoutMs),
      chunks: Uint8Array[] = [];
    let response: Response;
    try {
      response = await fetch(url, { signal, redirect: "error" });
    } catch {
      return {
        status: null,
        artifactDigest: null,
        truncated: false,
        failure: signal.aborted ? "timeout" : "network",
      };
    }
    const reader = response.body?.getReader();
    let length = 0,
      truncated = false;
    if (reader)
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 65536) {
            truncated = true;
            await reader.cancel();
            break;
          }
          chunks.push(chunk.value);
        }
      } catch {
        return {
          status: response.status,
          artifactDigest: null,
          truncated: false,
          failure: signal.aborted ? "timeout" : "body_read",
        };
      } finally {
        reader.releaseLock();
      }
    let artifactDigest: string | null = null;
    if (!truncated)
      try {
        artifactDigest = z
          .object({ artifactDigest: z.string().regex(/^[a-f0-9]{64}$/) })
          .passthrough()
          .parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))).artifactDigest;
      } catch {
        /* Unidentified health responses do not verify a release. */
      }
    return { status: response.status, artifactDigest, truncated, failure: null };
  }
}
