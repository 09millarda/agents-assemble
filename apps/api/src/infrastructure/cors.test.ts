import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createCorsMiddleware, resolveAllowedOrigins } from "./cors";

function buildProbedApp() {
  const probed = new Hono();
  probed.use(createCorsMiddleware({ ALLOWED_ORIGINS: "http://localhost:3000,http://localhost:3002" } as NodeJS.ProcessEnv));
  probed.get("/daemons", (context) => context.json({ daemons: [] }));
  return probed;
}

describe("factory API CORS", () => {
  test("preflight from the portal succeeds with the calling origin", async () => {
    const response = await buildProbedApp().request("/daemons", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("actual responses carry the calling origin", async () => {
    const response = await buildProbedApp().request("/daemons", {
      headers: { Origin: "http://localhost:3000" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("defaults cover the local portal and marketing origins", () => {
    expect(resolveAllowedOrigins({} as NodeJS.ProcessEnv)).toEqual(["http://localhost:3000", "http://localhost:3002"]);
  });
});
