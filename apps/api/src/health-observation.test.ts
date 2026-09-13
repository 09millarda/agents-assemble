import { createServer } from "node:http";
import { expect, it } from "vitest";
import { readHealth } from "../../../examples/reference-delivery/scripts/health.ts";
import { HttpHealthObservation } from "./health-observation.ts";

it("bounds the live external response stream before decoding and identifies only exact release digests", async () => {
  const digest = "a".repeat(64);
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/oversized") {
      res.write('{"padding":"');
      res.write("x".repeat(131072));
      res.end(`","artifactDigest":"${digest}"}`);
    } else res.end(JSON.stringify({ artifactDigest: digest }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing_address");
  try {
    const reader = new HttpHealthObservation();
    expect(await reader.read(`http://127.0.0.1:${address.port}/health`)).toEqual({
      status: 200,
      artifactDigest: digest,
      truncated: false,
      failure: null,
    });
    expect(await reader.read(`http://127.0.0.1:${address.port}/oversized`)).toEqual({
      status: 200,
      artifactDigest: null,
      truncated: true,
      failure: null,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.each([
  {
    name: "control plane",
    read: (url: string) => new HttpHealthObservation({ timeoutMs: 40 }).read(url),
  },
  { name: "reference workflow", read: (url: string) => readHealth(url, 40) },
])(
  "records refused connections and bounded response timeouts without invented status: $name",
  async ({ read }) => {
    const server = createServer((req, res) => {
      if (req.url === "/body") {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"artifactDigest":"');
      }
      // Both routes retain the connection so the actual request deadline must settle it.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing_address");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      for (const path of ["/headers", "/body"]) {
        const started = Date.now();
        expect(await read(`${base}${path}`)).toMatchObject({
          status: path === "/headers" ? null : 200,
          artifactDigest: null,
          failure: "timeout",
        });
        expect(Date.now() - started).toBeLessThan(2000);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await read(base)).toMatchObject({
      status: null,
      artifactDigest: null,
      failure: "network",
    });
  },
);
