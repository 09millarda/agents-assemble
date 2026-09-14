import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { z } from "zod";
import { sha256 } from "./protocol.ts";
import { supervisorConfigSchema } from "./supervisor.ts";
export const runnerConfigSchema = z.strictObject({
  version: z.literal("aa-runner/1"),
  serviceUrl: z.url(),
  runnerId: z.string(),
  organizationId: z.string(),
  deploymentId: z.string(),
  journalId: z.string(),
  credentialGeneration: z.int().positive(),
  expiresAt: z.iso.datetime(),
  caFile: z.string(),
  certificateFile: z.string(),
  privateKeyFile: z.string(),
  codexBinary: z.string().default("codex"),
  secretFile: z.string().optional(),
  supervisor: supervisorConfigSchema.optional(),
  pollIntervalMs: z.int().min(100).max(60000).default(1000),
});
export type RunnerConfig = z.infer<typeof runnerConfigSchema>;
export class RunnerTransport {
  constructor(
    readonly serviceUrl: string,
    readonly options: { caFile: string; certificateFile?: string; privateKeyFile?: string },
  ) {
    const url = new URL(serviceUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      throw new Error("runner_requires_https_service");
  }
  async post(path: string, payload: unknown, idempotencyKey?: string): Promise<unknown> {
    const ca = await readFile(this.options.caFile);
    const cert = this.options.certificateFile
      ? await readFile(this.options.certificateFile)
      : undefined;
    const key = this.options.privateKeyFile
      ? await readFile(this.options.privateKeyFile)
      : undefined;
    const bytes = Buffer.from(JSON.stringify(payload));
    if (bytes.length > 4 * 1024 * 1024) throw new Error("runner_request_too_large");
    return new Promise((resolve, reject) => {
      const operation = z.object({ operationId: z.string() }).safeParse(payload);
      const req = request(
        new URL(path, this.serviceUrl),
        {
          method: "POST",
          ca,
          cert,
          key,
          rejectUnauthorized: true,
          minVersion: "TLSv1.3",
          headers: {
            "content-type": "application/json",
            "content-length": bytes.length,
            "idempotency-key": operation.success
              ? operation.data.operationId
              : (idempotencyKey ?? sha256(bytes)),
          },
          timeout: 15000,
        },
        (res) => {
          const buffers: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 4 * 1024 * 1024) {
              req.destroy(new Error("runner_response_too_large"));
              return;
            }
            buffers.push(chunk);
          });
          res.on("end", () => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`runner_http_${res.statusCode ?? "unknown"}`));
              return;
            }
            try {
              resolve(JSON.parse(Buffer.concat(buffers).toString("utf8")));
            } catch {
              reject(new Error("runner_invalid_json_response"));
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("runner_transport_timeout")));
      req.on("error", reject);
      req.end(bytes);
    });
  }
}
