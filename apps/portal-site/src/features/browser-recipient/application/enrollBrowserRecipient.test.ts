import { expect, test } from "bun:test";
import { enrollBrowserRecipient } from "./enrollBrowserRecipient";
import type {
  BrowserCredential,
  BrowserPushSubscription,
  BrowserRecipientPort,
} from "../domain/BrowserRecipientPort";

test("enrollment preserves an existing browser identity while replacing its subscription", async () => {
  const bound: BrowserCredential[] = [];
  const credential = { recipientId: "browser-1", managementToken: "private-1" };
  const api: BrowserRecipientPort = {
    async createRecipient() {
      throw new Error("Existing browser must be reused");
    },
    async getStatus() {
      return {
        recipientId: "browser-1",
        active: false,
        deliveryStatus: "expired",
        vapidPublicKey: "public-key",
      };
    },
    async replaceSubscription(identity, _subscription) {
      bound.push(identity);
      return {
        recipientId: "browser-1",
        active: true,
        deliveryStatus: "enrolled",
        vapidPublicKey: "public-key",
      };
    },
  };
  const browser = {
    async requestPermission() {
      return "granted" as const;
    },
    loadCredential() {
      return credential;
    },
    saveCredential() {},
    async subscribe(_publicKey: string): Promise<BrowserPushSubscription> {
      return {
        endpoint: "https://push.example/browser-1",
        keys: { auth: "auth", p256dh: "key" },
      };
    },
  };
  expect(await enrollBrowserRecipient(api, browser)).toEqual({
    recipientId: "browser-1",
    active: true,
    deliveryStatus: "enrolled",
    vapidPublicKey: "public-key",
  });
  expect(bound).toEqual([credential]);
});

test("expired subscriptions are replaced without minting another browser recipient", async () => {
  const subscriptions: { key: string; replaceExisting: boolean }[] = [];
  const api: BrowserRecipientPort = {
    async createRecipient() {
      throw new Error("Must preserve recipient");
    },
    async getStatus() {
      return {
        recipientId: "browser-1",
        active: false,
        deliveryStatus: "expired",
        vapidPublicKey: "public-key",
      };
    },
    async replaceSubscription() {
      return {
        recipientId: "browser-1",
        active: true,
        deliveryStatus: "enrolled",
        vapidPublicKey: "public-key",
      };
    },
  };
  await enrollBrowserRecipient(api, {
    async requestPermission() {
      return "granted";
    },
    loadCredential() {
      return { recipientId: "browser-1", managementToken: "private-1" };
    },
    saveCredential() {},
    async subscribe(key: string, replaceExisting: boolean) {
      subscriptions.push({ key, replaceExisting });
      return {
        endpoint: "https://push.example/new-endpoint",
        keys: { auth: "auth", p256dh: "key" },
      };
    },
  });
  expect(subscriptions).toEqual([{ key: "public-key", replaceExisting: true }]);
});
