import { describe, expect, test } from "bun:test";
import {
  deleteDaemonRegistration,
  resolveDaemonDeletionTarget,
  shouldClearLocalCredentials,
} from "./deleteDaemon";

describe("resolveDaemonDeletionTarget", () => {
  test("defaults to the locally stored identity", () => {
    const result = resolveDaemonDeletionTarget(
      { daemonId: "daemon-1", authToken: "token", factoryApiUrl: "http://localhost:3001" },
      undefined,
      undefined
    );
    expect(result).toEqual({ ok: true, value: { daemonId: "daemon-1", factoryApiUrl: "http://localhost:3001" } });
  });

  test("accepts an explicit id", () => {
    const result = resolveDaemonDeletionTarget(
      { daemonId: "daemon-1", authToken: "token", factoryApiUrl: "http://localhost:3001" },
      "daemon-9",
      undefined
    );
    expect(result.ok && result.value.daemonId).toBe("daemon-9");
  });

  test("fails without any identity", () => {
    const result = resolveDaemonDeletionTarget(null, undefined, undefined);
    expect(result.ok).toBe(false);
  });
});

describe("shouldClearLocalCredentials", () => {
  test("clears the credential store only on self-delete", () => {
    const stored = { daemonId: "daemon-1", authToken: "token", factoryApiUrl: "http://localhost:3001" };
    expect(shouldClearLocalCredentials(stored, "daemon-1")).toBe(true);
    expect(shouldClearLocalCredentials(stored, "daemon-2")).toBe(false);
    expect(shouldClearLocalCredentials(null, "daemon-1")).toBe(false);
  });
});

describe("deleteDaemonRegistration", () => {
  test("posts to the deregister endpoint", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedMethod = init?.method ?? "GET";
      return new Response(JSON.stringify({ daemonId: "daemon-1", status: "deregistered" }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await deleteDaemonRegistration("http://localhost:3001", "daemon-1", fetchImpl);
    expect(result.ok).toBe(true);
    expect(requestedUrl).toBe("http://localhost:3001/v1/daemons/daemon-1/deregister");
    expect(requestedMethod).toBe("POST");
  });

  test("maps unknown ids to not-found", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const result = await deleteDaemonRegistration("http://localhost:3001", "ghost", fetchImpl);
    expect(result).toEqual({ ok: false, error: { code: "DAEMON_NOT_FOUND", message: expect.any(String) } });
  });
});
