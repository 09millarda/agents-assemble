import { afterEach, describe, expect, test } from "bun:test";
import { HttpDeviceAuthorizationAdapter } from "./HttpDeviceAuthorizationAdapter";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(handler: (url: string, body: unknown) => Response): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const payload = init?.body ? JSON.parse(String(init.body)) : null;
    return handler(String(input), payload);
  }) as typeof fetch;
}

describe("HttpDeviceAuthorizationAdapter", () => {
  test("approve posts the user code to /v1/device/approve", async () => {
    let requestedUrl = "";
    let requestedBody: unknown = null;
    stubFetch((url, body) => {
      requestedUrl = url;
      requestedBody = body;
      return new Response(JSON.stringify({ daemonId: "daemon-1" }), { status: 200 });
    });

    await expect(new HttpDeviceAuthorizationAdapter("http://localhost:3001").approveDeviceAuthorization("ABCD-2345")).resolves.toEqual({
      daemonId: "daemon-1",
    });
    expect(requestedUrl).toBe("http://localhost:3001/v1/device/approve");
    expect(requestedBody).toEqual({ user_code: "ABCD-2345" });
  });

  test("deny posts the user code to /v1/device/deny", async () => {
    let requestedUrl = "";
    stubFetch((url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ denied: true }), { status: 200 });
    });

    await expect(new HttpDeviceAuthorizationAdapter("http://localhost:3001").denyDeviceAuthorization("ABCD-2345")).resolves.toEqual({
      denied: true,
    });
    expect(requestedUrl).toBe("http://localhost:3001/v1/device/deny");
  });

  test("throws the problem detail when approval fails", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ type: "t", title: "Bad Request", status: 400, detail: "User code is expired.", code: "INVALID_USER_CODE", instance: "/v1/device/approve" }),
          { status: 400, headers: { "content-type": "application/problem+json" } }
        )
    );

    await expect(new HttpDeviceAuthorizationAdapter("http://localhost:3001").approveDeviceAuthorization("ABCD-2345")).rejects.toThrow(
      "User code is expired."
    );
  });
});
