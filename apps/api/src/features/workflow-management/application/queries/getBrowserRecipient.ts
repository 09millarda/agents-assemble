import type { Result } from "@factory/shared-domain";
import type {
  BrowserRecipientPort,
  BrowserRecipient,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
export async function getBrowserRecipient(
  store: BrowserRecipientPort,
  recipientId: string,
  managementToken: string,
): Promise<Result<BrowserRecipient, WorkflowError>> {
  if (!(await store.authorizeRecipient(recipientId, managementToken)))
    return {
      ok: false,
      error: {
        code: "RECIPIENT_UNAUTHORIZED",
        message: "Browser management token is invalid.",
      },
    };
  const recipient = await store.findRecipient(recipientId);
  return recipient
    ? { ok: true, value: recipient }
    : {
        ok: false,
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "Browser recipient does not exist.",
        },
      };
}
