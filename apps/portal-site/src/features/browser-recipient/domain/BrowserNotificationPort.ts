import type {
  BrowserCredential,
  BrowserPushSubscription,
} from "./BrowserRecipientPort";
export interface BrowserNotificationPort {
  requestPermission(): Promise<"granted" | "denied" | "default">;
  loadCredential(): BrowserCredential | null;
  saveCredential(credential: BrowserCredential): void;
  subscribe(
    publicKey: string,
    replaceExisting: boolean,
  ): Promise<BrowserPushSubscription>;
}
