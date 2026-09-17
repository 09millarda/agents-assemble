import { describe, expect, test } from "bun:test";
import { formatLoginPrompt, resolveDaemonCredentials, runDeviceLoginFlow } from "./loginFlow";
import type { StoredCredentials } from "../infrastructure/credentialStore";

const DEEP_LINK_URI = "http://portal/#/device?code=ABCD-2345";

function approvedFetch(verificationUri: string = DEEP_LINK_URI) {
  return (async (url: string) => {
    if (String(url).endsWith("/device/authorizations")) {
      return {
        ok: true,
        json: async () => ({ device_code: "device-1", user_code: "ABCD-2345", verification_uri: verificationUri, expires_in: 600, interval: 5 }),
      } as Response;
    }
    return { ok: true, json: async () => ({ status: "approved", daemonId: "daemon-1", authToken: "token-1" }) } as Response;
  }) as unknown as typeof fetch;
}

describe("runDeviceLoginFlow", () => {
  test("output contains the user code and verification URL", async () => {
    const printed: string[] = [];
    const saved: StoredCredentials[] = [];
    const credentials = await runDeviceLoginFlow("http://api", "workstation", true, {
      fetchImpl: approvedFetch(),
      sleepMs: async () => {},
      nowMs: () => 0,
      print: (message) => printed.push(message),
      saveCredentials: (next) => saved.push(next),
      waitForConfirmation: async () => {},
    });

    expect(credentials).toEqual({ daemonId: "daemon-1", authToken: "token-1", factoryApiUrl: "http://api" });
    expect(printed.some((line) => line.includes("ABCD-2345") && line.includes(DEEP_LINK_URI))).toBe(true);
    expect(saved).toHaveLength(1);
  });

  test("opens the deep-link verification URI verbatim", async () => {
    const openedUrls: string[] = [];
    await runDeviceLoginFlow("http://api", "workstation", false, {
      fetchImpl: approvedFetch(),
      sleepMs: async () => {},
      nowMs: () => 0,
      print: () => {},
      openUrl: async (url) => { openedUrls.push(url); return true; },
      waitForConfirmation: async () => {},
    });

    expect(openedUrls).toEqual([DEEP_LINK_URI]);
  });

  test("browser opener is skipped with --no-browser", async () => {
    let opened = 0;
    await runDeviceLoginFlow("http://api", "workstation", true, {
      fetchImpl: approvedFetch(),
      sleepMs: async () => {},
      nowMs: () => 0,
      print: () => {},
      openUrl: async () => { opened += 1; return true; },
      waitForConfirmation: async () => {},
    });

    expect(opened).toBe(0);
  });

  test("browser opener runs by default and falls back to a printed URL", async () => {
    const printed: string[] = [];
    await runDeviceLoginFlow("http://api", "workstation", false, {
      fetchImpl: approvedFetch(),
      sleepMs: async () => {},
      nowMs: () => 0,
      print: (message) => printed.push(message),
      openUrl: async () => false,
      waitForConfirmation: async () => {},
    });

    expect(printed.some((line) => line.includes("Open this URL manually"))).toBe(true);
  });
});

describe("formatLoginPrompt", () => {
  test("reads as an instruction with code and URL", () => {
    expect(formatLoginPrompt({ device_code: "d", user_code: "ABCD-2345", verification_uri: DEEP_LINK_URI, expires_in: 600, interval: 5 }))
      .toBe(`Go to ${DEEP_LINK_URI} and enter code ABCD-2345`);
  });
});

describe("resolveDaemonCredentials", () => {
  const stored: StoredCredentials = { daemonId: "daemon-1", authToken: "token-1", factoryApiUrl: "http://api" };
  const fresh: StoredCredentials = { daemonId: "daemon-2", authToken: "token-2", factoryApiUrl: "http://api" };

  test("reuses valid stored credentials without logging in", async () => {
    let logins = 0;
    const resolved = await resolveDaemonCredentials({
      loadCredentials: () => stored,
      factoryApiUrl: "http://api",
      probeCredentials: async () => true,
      runLogin: async () => { logins += 1; return fresh; },
    });

    expect(resolved).toEqual(stored);
    expect(logins).toBe(0);
  });

  test("rejected credentials trigger an inline login", async () => {
    const resolved = await resolveDaemonCredentials({
      loadCredentials: () => stored,
      factoryApiUrl: "http://api",
      probeCredentials: async () => false,
      runLogin: async () => fresh,
    });

    expect(resolved).toEqual(fresh);
  });

  test("missing credentials trigger an inline login", async () => {
    const resolved = await resolveDaemonCredentials({
      loadCredentials: () => null,
      factoryApiUrl: "http://api",
      probeCredentials: async () => true,
      runLogin: async () => fresh,
    });

    expect(resolved).toEqual(fresh);
  });
});

describe("runDeviceLoginFlow confirmation", () => {
  test("confirmation block contains user code, verification URL, and machine name, ending with Hit Enter to continue", async () => {
    const printed: string[] = [];
    await runDeviceLoginFlow("http://api", "workstation", true, {
      fetchImpl: approvedFetch(),
      sleepMs: async () => {},
      nowMs: () => 0,
      print: (message) => printed.push(message),
      waitForConfirmation: async () => {},
    });

    const block = printed.join("\n");
    expect(block).toContain("ABCD-2345");
    expect(block).toContain(DEEP_LINK_URI);
    expect(block).toContain("workstation");
  });

  test("--no-browser still prompts and annotates manual open", async () => {
    const printed: string[] = [];
    await runDeviceLoginFlow("http://api", "workstation", true, {
      fetchImpl: approvedFetch(),
      sleepMs: async () => {},
      nowMs: () => 0,
      print: (message) => printed.push(message),
      waitForConfirmation: async () => {},
    });

    expect(printed.some((line) => line.includes("open manually with --no-browser"))).toBe(true);
  });

  test("browser mode annotates auto-open", async () => {
    const printed: string[] = [];
    await runDeviceLoginFlow("http://api", "workstation", false, {
      fetchImpl: approvedFetch(),
      sleepMs: async () => {},
      nowMs: () => 0,
      print: (message) => printed.push(message),
      openUrl: async () => true,
      waitForConfirmation: async () => {},
    });

    expect(printed.some((line) => line.includes("will open in browser"))).toBe(true);
  });

  test("openUrl and token polling wait until confirmation resolves", async () => {
    let confirm: () => void = () => {};
    const gate = new Promise<void>((resolve) => { confirm = resolve; });
    let polls = 0;
    const countingFetch = (async (url: string) => {
      if (String(url).endsWith("/device/authorizations")) {
        return {
          ok: true,
          json: async () => ({ device_code: "device-1", user_code: "ABCD-2345", verification_uri: DEEP_LINK_URI, expires_in: 600, interval: 5 }),
        } as Response;
      }
      polls += 1;
      return { ok: true, json: async () => ({ status: "approved", daemonId: "daemon-1", authToken: "token-1" }) } as Response;
    }) as unknown as typeof fetch;
    let opened = 0;
    const pending = runDeviceLoginFlow("http://api", "workstation", false, {
      fetchImpl: countingFetch,
      sleepMs: async () => {},
      nowMs: () => 0,
      print: () => {},
      openUrl: async () => { opened += 1; return true; },
      waitForConfirmation: () => gate,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened).toBe(0);
    expect(polls).toBe(0);
    confirm();
    await pending;
    expect(opened).toBe(1);
    expect(polls).toBe(1);
  });

  test("confirmation rejection aborts login with no browser, poll, or save", async () => {
    let polls = 0;
    const countingFetch = (async (url: string) => {
      if (String(url).endsWith("/device/authorizations")) {
        return {
          ok: true,
          json: async () => ({ device_code: "device-1", user_code: "ABCD-2345", verification_uri: DEEP_LINK_URI, expires_in: 600, interval: 5 }),
        } as Response;
      }
      polls += 1;
      return { ok: true, json: async () => ({ status: "approved", daemonId: "daemon-1", authToken: "token-1" }) } as Response;
    }) as unknown as typeof fetch;
    let opened = 0;
    let saved = 0;
    await expect(runDeviceLoginFlow("http://api", "workstation", false, {
      fetchImpl: countingFetch,
      sleepMs: async () => {},
      nowMs: () => 0,
      print: () => {},
      openUrl: async () => { opened += 1; return true; },
      saveCredentials: () => { saved += 1; },
      waitForConfirmation: async () => { throw new Error("Login cancelled before approval."); },
    })).rejects.toThrow("Login cancelled before approval.");
    expect(opened).toBe(0);
    expect(polls).toBe(0);
    expect(saved).toBe(0);
  });
});

describe("runDeviceLoginFlow confirmation prompt ownership", () => {
  test("login flow leaves the confirmation prompt to infrastructure (cursor sits after the colon)", async () => {
    const printed: string[] = [];
    let confirmations = 0;
    await runDeviceLoginFlow("http://api", "workstation", true, {
      fetchImpl: approvedFetch(),
      sleepMs: async () => {},
      nowMs: () => 0,
      print: (message) => printed.push(message),
      waitForConfirmation: async () => { confirmations += 1; },
    });

    expect(confirmations).toBe(1);
    expect(printed.some((line) => line.includes("Hit Enter"))).toBe(false);
  });
});

describe("runDeviceLoginFlow authorization waiting indicator", () => {
  test("prints the authorized daemon after stopping the waiting indicator", async () => {
    const events: string[] = [];

    await runDeviceLoginFlow("http://api", "workstation", true, {
      fetchImpl: approvedFetch(),
      sleepMs: async () => {},
      nowMs: () => 0,
      print: (message) => events.push(`print:${message}`),
      waitForConfirmation: async () => {},
      waitIndicator: {
        start: () => events.push("indicator:start"),
        stop: () => events.push("indicator:stop"),
      },
    });

    expect(events.indexOf("indicator:stop")).toBeLessThan(events.indexOf("print:authorized daemon daemon-1"));
  });

  test("indicator starts before polling and stops after approval", async () => {
    const events: string[] = [];
    let releasePoll: () => void = () => {};
    const pollGate = new Promise<void>((resolve) => { releasePoll = resolve; });
    const gatedFetch = (async (url: string) => {
      if (String(url).endsWith("/device/authorizations")) {
        return {
          ok: true,
          json: async () => ({ device_code: "device-1", user_code: "ABCD-2345", verification_uri: DEEP_LINK_URI, expires_in: 600, interval: 5 }),
        } as Response;
      }
      await pollGate;
      return { ok: true, json: async () => ({ status: "approved", daemonId: "daemon-1", authToken: "token-1" }) } as Response;
    }) as unknown as typeof fetch;
    const pending = runDeviceLoginFlow("http://api", "workstation", true, {
      fetchImpl: gatedFetch,
      sleepMs: async () => {},
      nowMs: () => 0,
      print: () => {},
      waitForConfirmation: async () => {},
      waitIndicator: { start: () => events.push("start"), stop: () => events.push("stop") },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(["start"]);
    releasePoll();
    await pending;
    expect(events).toEqual(["start", "stop"]);
  });

  test("indicator stops when polling fails", async () => {
    const events: string[] = [];
    const deniedFetch = (async (url: string) => {
      if (String(url).endsWith("/device/authorizations")) {
        return {
          ok: true,
          json: async () => ({ device_code: "device-1", user_code: "ABCD-2345", verification_uri: DEEP_LINK_URI, expires_in: 600, interval: 5 }),
        } as Response;
      }
      return { ok: false, status: 403, json: async () => ({ status: 403, code: "access_denied", detail: "Device authorization was denied." }) } as Response;
    }) as unknown as typeof fetch;
    await expect(runDeviceLoginFlow("http://api", "workstation", true, {
      fetchImpl: deniedFetch,
      sleepMs: async () => {},
      nowMs: () => 0,
      print: () => {},
      waitForConfirmation: async () => {},
      waitIndicator: { start: () => events.push("start"), stop: () => events.push("stop") },
    })).rejects.toThrow();
    expect(events).toEqual(["start", "stop"]);
  });
});

describe("stable daemon identity", () => {
  test("re-login forwards the stored daemon ID to the authorizations endpoint", async () => {
    const bodies: unknown[] = [];
    const captureFetch = (async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith("/device/authorizations")) {
        bodies.push(JSON.parse(String(init?.body)));
        return { ok: true, json: async () => ({ device_code: "device-1", user_code: "ABCD-2345", verification_uri: DEEP_LINK_URI, expires_in: 600, interval: 5 }) };
      }
      return { ok: true, json: async () => ({ status: "approved", daemonId: "daemon-1", authToken: "token-1" }) };
    }) as unknown as typeof fetch;

    await runDeviceLoginFlow("http://api", "workstation", true, {
      fetchImpl: captureFetch,
      existingDaemonId: "daemon-1",
      sleepMs: async () => {},
      nowMs: () => 0,
      print: () => {},
      saveCredentials: () => {},
      waitForConfirmation: async () => {},
    });

    expect(bodies).toEqual([{ machineName: "workstation", daemon_id: "daemon-1" }]);
  });
});
