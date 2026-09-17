import { describe, expect, test } from "bun:test";
import { pollForDeviceCredentials, requestDeviceLogin, resolveFactoryApiUrl } from "./deviceLogin";
import type { DeviceFlowAuthorization } from "./deviceLogin";

function authorization(): DeviceFlowAuthorization {
  return { device_code: "device-1", user_code: "ABCD-2345", verification_uri: "http://portal/device", expires_in: 600, interval: 5 };
}

interface StubReply {
  status: number;
  body: unknown;
}

function stubFetch(replies: StubReply[]) {
  let calls = 0;
  const fetchImpl = (async () => {
    const reply = replies[Math.min(calls, replies.length - 1)];
    calls += 1;
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

function accessDeniedProblem(): StubReply {
  return {
    status: 403,
    body: { type: "https://factory.local/problems/access-denied", title: "Forbidden", status: 403, detail: "Device authorization was denied.", code: "access_denied", instance: "/v1/device/token" },
  };
}

describe("resolveFactoryApiUrl", () => {
  test("prefers the explicit flag, then env, then localhost", () => {
    expect(resolveFactoryApiUrl("http://flag/")).toBe("http://flag");
    expect(resolveFactoryApiUrl(undefined)).toBe(process.env.FACTORY_API_URL ?? "http://localhost:3001");
  });
});

describe("pollForDeviceCredentials", () => {
  test("pending then approved yields credentials", async () => {
    const { fetchImpl } = stubFetch([
      { status: 200, body: { status: "pending" } },
      { status: 200, body: { status: "approved", daemonId: "daemon-1", authToken: "token-1" } },
    ]);
    let now = 0;
    const sleeps: number[] = [];
    const outcome = await pollForDeviceCredentials("http://api", authorization(), {
      fetchImpl,
      sleepMs: async (delayMs) => { sleeps.push(delayMs); now += delayMs; },
      nowMs: () => now,
    });

    expect(outcome).toEqual({ ok: true, credentials: { daemonId: "daemon-1", authToken: "token-1", factoryApiUrl: "http://api" } });
    expect(sleeps).toEqual([5000, 5000]);
  });

  test("a 429 problem backs off before retrying", async () => {
    const { fetchImpl } = stubFetch([
      { status: 429, body: { status: 429, code: "slow_down", detail: "Polling too fast." } },
      { status: 200, body: { status: "approved", daemonId: "daemon-1", authToken: "token-1" } },
    ]);
    let now = 0;
    const sleeps: number[] = [];
    const outcome = await pollForDeviceCredentials("http://api", authorization(), {
      fetchImpl,
      sleepMs: async (delayMs) => { sleeps.push(delayMs); now += delayMs; },
      nowMs: () => now,
    });

    expect(outcome.ok).toBe(true);
    expect(sleeps).toEqual([5000, 10000]);
  });

  test("denied grant maps to access_denied", async () => {
    const { fetchImpl } = stubFetch([accessDeniedProblem()]);
    const outcome = await pollForDeviceCredentials("http://api", authorization(), {
      fetchImpl,
      sleepMs: async () => {},
      nowMs: () => 0,
    });

    expect(outcome).toEqual({ ok: false, error: { code: "access_denied", message: "Device authorization was denied." } });
  });

  test("expired grant maps to expired_token", async () => {
    const { fetchImpl } = stubFetch([{ status: 410, body: { status: 410, code: "expired_token", detail: "Expired." } }]);
    const outcome = await pollForDeviceCredentials("http://api", authorization(), {
      fetchImpl,
      sleepMs: async () => {},
      nowMs: () => 0,
    });

    expect(outcome).toEqual({ ok: false, error: { code: "expired_token", message: "Expired." } });
  });

  test("an elapsed deadline maps to expired_token", async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { status: "pending" } }]);
    let now = 0;
    const outcome = await pollForDeviceCredentials("http://api", authorization(), {
      fetchImpl,
      sleepMs: async (delayMs) => { now += delayMs + 600_000; },
      nowMs: () => now,
    });

    expect(outcome).toEqual({ ok: false, error: { code: "expired_token", message: expect.any(String) as string } });
    expect(calls()).toBe(1);
  });
});

describe("stable daemon identity", () => {
  test("re-login sends the stored daemon ID for the same API URL", async () => {
    const requestedUrls: string[] = [];
    const bodies: unknown[] = [];
    const fetchImpl = (async (url: string, init: { body?: string }) => {
      requestedUrls.push(String(url));
      bodies.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await requestDeviceLogin("http://api", "workstation", fetchImpl, "daemon-1");

    expect(requestedUrls).toEqual(["http://api/v1/device/authorizations"]);
    expect(bodies).toEqual([{ machineName: "workstation", daemon_id: "daemon-1" }]);
  });

  test("fresh logins omit the daemon ID", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (url: string, init: { body?: string }) => {
      bodies.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await requestDeviceLogin("http://api", "workstation", fetchImpl);

    expect(bodies).toEqual([{ machineName: "workstation" }]);
  });
});
