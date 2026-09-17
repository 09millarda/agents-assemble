import type { Result } from "@factory/shared-domain";
import type {
  BrowserRecipientPort,
  BrowserRecipient,
  WorkflowError,
  PushSubscription,
} from "../../domain/WorkflowStorePort";
import { getBrowserRecipient } from "../queries/getBrowserRecipient";
export async function replaceBrowserSubscription(
  store: BrowserRecipientPort,
  recipientId: string,
  managementToken: string,
  subscription: PushSubscription | null,
): Promise<Result<BrowserRecipient, WorkflowError>> {
  const authorized = await getBrowserRecipient(
    store,
    recipientId,
    managementToken,
  );
  return authorized.ok
    ? {
        ok: true,
        value: await store.replaceSubscription(recipientId, subscription),
      }
    : authorized;
}
