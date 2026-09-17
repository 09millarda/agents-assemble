import { afterEach, expect, test } from "bun:test";
import { HttpBrowserRecipientAdapter } from "./HttpBrowserRecipientAdapter";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("browser subscription replacement and status require that browser's management token", async () => {
  const requests: {
    url: string;
    authorization: string | null;
    body: unknown;
  }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json({
        recipientId: "browser-1",
        active: false,
        deliveryStatus: "not-enrolled",
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const adapter = new HttpBrowserRecipientAdapter("https://factory.example");
  await adapter.getStatus({
    recipientId: "browser-1",
    managementToken: "secret-1",
  });
  await adapter.replaceSubscription(
    { recipientId: "browser-1", managementToken: "secret-1" },
    null,
  );
  expect(requests).toEqual([
    {
      url: "https://factory.example/v1/browser-recipients/browser-1",
      authorization: "Bearer secret-1",
      body: null,
    },
    {
      url: "https://factory.example/v1/browser-recipients/browser-1/subscription",
      authorization: null,
      body: { managementToken: "secret-1", subscription: null },
    },
  ]);
});
