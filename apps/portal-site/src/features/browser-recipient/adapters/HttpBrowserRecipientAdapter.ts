import { FactoryHttpClient } from "../../../infrastructure/http/FactoryHttpClient";
import type {
  BrowserCredential,
  BrowserPushSubscription,
  BrowserRecipientPort,
  BrowserRecipientStatus,
} from "../domain/BrowserRecipientPort";

export class HttpBrowserRecipientAdapter implements BrowserRecipientPort {
  private readonly http: FactoryHttpClient;
  constructor(baseUrl?: string) {
    this.http = new FactoryHttpClient(baseUrl);
  }
  createRecipient(): Promise<BrowserRecipientStatus & BrowserCredential> {
    return this.http.post("/v1/browser-recipients", {});
  }
  getStatus(credential: BrowserCredential): Promise<BrowserRecipientStatus> {
    return this.http.request(
      `/v1/browser-recipients/${encodeURIComponent(credential.recipientId)}`,
      { headers: { authorization: `Bearer ${credential.managementToken}` } },
    );
  }
  replaceSubscription(
    credential: BrowserCredential,
    subscription: BrowserPushSubscription | null,
  ): Promise<BrowserRecipientStatus> {
    return this.http.post(
      `/v1/browser-recipients/${encodeURIComponent(credential.recipientId)}/subscription`,
      { managementToken: credential.managementToken, subscription },
    );
  }
}
