import { z } from "zod";

/** A failed observation never fabricates an HTTP status or a release identity. */
export async function readHealth(url: string, timeoutMs = 15000) {
  const signal = AbortSignal.timeout(z.int().min(1).max(15000).parse(timeoutMs));
  let response: Response;
  try {
    response = await fetch(url, { signal, redirect: "error" });
  } catch {
    return {
      status: null,
      artifactDigest: null,
      failure: signal.aborted ? ("timeout" as const) : ("network" as const),
    };
  }
  const reader = response.body?.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  if (reader)
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > 65536) {
          await reader.cancel();
          break;
        }
        chunks.push(next.value);
      }
    } catch {
      return {
        status: response.status,
        artifactDigest: null,
        failure: signal.aborted ? ("timeout" as const) : ("body_read" as const),
      };
    } finally {
      reader.releaseLock();
    }
  let artifactDigest: string | null = null;
  if (total <= 65536)
    try {
      artifactDigest = z
        .object({ artifactDigest: z.string().regex(/^[a-f0-9]{64}$/) })
        .passthrough()
        .parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))).artifactDigest;
    } catch {
      /* The response cannot establish the deployed release identity. */
    }
  return { status: response.status, artifactDigest, failure: null };
}
