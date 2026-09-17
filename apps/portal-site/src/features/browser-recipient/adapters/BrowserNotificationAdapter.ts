import { resolveFactoryApiUrl } from "../../../infrastructure/http/FactoryHttpClient";
import type { BrowserNotificationPort } from "../domain/BrowserNotificationPort";
import type {
  BrowserCredential,
  BrowserPushSubscription,
} from "../domain/BrowserRecipientPort";

export class BrowserNotificationAdapter implements BrowserNotificationPort {
  private readonly storageKey = `factory.browser-recipient:${resolveFactoryApiUrl()}`;
  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      window.isSecureContext &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }
  requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported())
      return Promise.reject(
        new Error("This browser needs a secure origin and Web Push support."),
      );
    return Notification.requestPermission();
  }
  loadCredential(): BrowserCredential | null {
    if (typeof localStorage === "undefined") return null;
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(this.storageKey) ?? "null",
      );
      if (
        saved &&
        typeof saved === "object" &&
        "recipientId" in saved &&
        typeof saved.recipientId === "string" &&
        "managementToken" in saved &&
        typeof saved.managementToken === "string"
      )
        return {
          recipientId: saved.recipientId,
          managementToken: saved.managementToken,
        };
    } catch {
      return null;
    }
    return null;
  }
  saveCredential(credential: BrowserCredential): void {
    localStorage.setItem(this.storageKey, JSON.stringify(credential));
  }
  async subscribe(
    publicKey: string,
    replaceExisting: boolean,
  ): Promise<BrowserPushSubscription> {
    const registration = await navigator.serviceWorker.register(
      "/workflow-push.js",
      { scope: "/" },
    );
    await navigator.serviceWorker.ready;
    const decodedKey = atob(
      publicKey
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(publicKey.length / 4) * 4, "="),
    );
    const keyBytes = Uint8Array.from(decodedKey, (character) =>
      character.charCodeAt(0),
    );
    let existing = await registration.pushManager.getSubscription();
    if (existing && replaceExisting) {
      await existing.unsubscribe();
      existing = null;
    }
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes,
      }));
    const serialized = subscription.toJSON();
    if (
      !serialized.endpoint ||
      !serialized.keys?.auth ||
      !serialized.keys.p256dh
    )
      throw new Error("Browser returned an incomplete push subscription.");
    return {
      endpoint: serialized.endpoint,
      keys: { auth: serialized.keys.auth, p256dh: serialized.keys.p256dh },
      expirationTime: serialized.expirationTime,
    };
  }
}
