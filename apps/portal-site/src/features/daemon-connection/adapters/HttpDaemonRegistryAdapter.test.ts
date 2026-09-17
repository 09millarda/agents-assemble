import { afterEach, describe, expect, test } from "bun:test";
import { HttpDaemonRegistryAdapter } from "./HttpDaemonRegistryAdapter";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = (async (input: string | URL | Request) => handler(String(input))) as unknown as typeof fetch;
}

function daemonPage(daemonIds: string[], nextCursor: string | null): Response {
  return new Response(
    JSON.stringify({
      data: daemonIds.map((daemonId) => ({ daemonId, machineName: "workstation", status: "online" })),
      pagination: { nextCursor, limit: 100 },
    }),
    { status: 200 }
  );
}

describe("HttpDaemonRegistryAdapter", () => {
  test("passes through the paged daemon envelope", async () => {
    stubFetch(() => daemonPage(["d1"], null));

    await expect(new HttpDaemonRegistryAdapter("http://localhost:3001").listDaemons()).resolves.toEqual([
      { daemonId: "d1", machineName: "workstation", status: "online" },
    ]);
  });

  test("follows the cursor across pages", async () => {
    const requestedUrls: string[] = [];
    stubFetch((url) => {
      requestedUrls.push(url);
      if (url.includes("cursor=")) return daemonPage(["d2"], null);
      return daemonPage(["d1"], "Y3Vyc29yLTE");
    });

    await expect(new HttpDaemonRegistryAdapter("http://localhost:3001").listDaemons()).resolves.toEqual([
      { daemonId: "d1", machineName: "workstation", status: "online" },
      { daemonId: "d2", machineName: "workstation", status: "online" },
    ]);
    expect(requestedUrls).toEqual([
      "http://localhost:3001/v1/daemons?limit=100",
      "http://localhost:3001/v1/daemons?limit=100&cursor=Y3Vyc29yLTE",
    ]);
  });

  test("throws when the factory API errors", async () => {
    stubFetch(() => new Response("oops", { status: 500 }));

    await expect(new HttpDaemonRegistryAdapter("http://localhost:3001").listDaemons()).rejects.toThrow(
      "Failed to load daemons."
    );
  });

  test("ignores a trailing slash on the base URL", async () => {
    let requestedUrl = "";
    stubFetch((url) => {
      requestedUrl = url;
      return daemonPage([], null);
    });

    await new HttpDaemonRegistryAdapter("http://localhost:3001/").listDaemons();

    expect(requestedUrl).toBe("http://localhost:3001/v1/daemons?limit=100");
  });
});

describe("deregisterDaemon", () => {
  test("posts to the deregister endpoint", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    stubFetch((url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ daemonId: "d1", status: "deregistered" }), { status: 200 });
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedMethod = (init?.method ?? "GET");
      return new Response(JSON.stringify({ daemonId: "d1", status: "deregistered" }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await new HttpDaemonRegistryAdapter("http://localhost:3001").deregisterDaemon("d1");
    } finally {
      globalThis.fetch = original;
    }
    expect(requestedUrl).toBe("http://localhost:3001/v1/daemons/d1/deregister");
    expect(requestedMethod).toBe("POST");
  });

  test("treats a missing daemon as already removed", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    try {
      await expect(
        new HttpDaemonRegistryAdapter("http://localhost:3001").deregisterDaemon("ghost")
      ).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("treats an already-removed daemon as removed", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("gone", { status: 410 })) as unknown as typeof fetch;
    try {
      await expect(
        new HttpDaemonRegistryAdapter("http://localhost:3001").deregisterDaemon("ghost")
      ).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("throws when removal truly fails", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    try {
      await expect(new HttpDaemonRegistryAdapter("http://localhost:3001").deregisterDaemon("d1")).rejects.toThrow(
        "Failed to remove daemon."
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
