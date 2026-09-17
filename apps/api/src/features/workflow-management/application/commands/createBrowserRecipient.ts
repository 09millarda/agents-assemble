import type { BrowserRecipientPort } from "../../domain/WorkflowStorePort";
export function createBrowserRecipient(store: BrowserRecipientPort) {
  return store.createRecipient();
}
