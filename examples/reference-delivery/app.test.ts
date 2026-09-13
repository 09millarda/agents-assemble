import { describe, expect, it } from "vitest";
import { createApp, healthSchema } from "./app.ts";

describe("reference service immutable health identity", () => {
  it("reports only the deployed artifact digest and disables caching", async () => {
    const app = createApp("a".repeat(64));
    const response = await app.request(`/health?artifactDigest=${"b".repeat(64)}`, {
      headers: { Authorization: "Bearer private-token" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(healthSchema.parse(await response.json())).toEqual({
      status: "ok",
      artifactDigest: "a".repeat(64),
    });
  });
  it("refuses missing or malformed deployment identity and does not accept write routes", async () => {
    expect(() => createApp("")).toThrow();
    expect(() => createApp("latest")).toThrow();
    expect((await createApp("a".repeat(64)).request("/health", { method: "POST" })).status).toBe(
      404,
    );
  });
});
