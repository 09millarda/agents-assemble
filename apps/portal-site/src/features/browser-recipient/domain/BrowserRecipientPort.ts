export interface BrowserCredential {
  recipientId: string;
  managementToken: string;
}
export interface BrowserRecipientStatus {
  recipientId: string;
  active: boolean;
  deliveryStatus: string;
  vapidPublicKey: string | null;
  lastDeliveryError?: string | null;
}
export interface BrowserPushSubscription {
  endpoint: string;
  keys: { auth: string; p256dh: string };
  expirationTime?: number | null;
}
export interface BrowserRecipientPort {
  createRecipient(): Promise<BrowserRecipientStatus & BrowserCredential>;
  getStatus(credential: BrowserCredential): Promise<BrowserRecipientStatus>;
  replaceSubscription(
    credential: BrowserCredential,
    subscription: BrowserPushSubscription | null,
  ): Promise<BrowserRecipientStatus>;
}
