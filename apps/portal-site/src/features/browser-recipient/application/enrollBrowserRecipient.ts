import type { BrowserNotificationPort } from "../domain/BrowserNotificationPort";
import { canEnrollBrowser, hasDeniedNotifications, shouldReplaceExpiredSubscription } from "../domain/browserEnrollmentPolicy";
import type {
  BrowserRecipientPort,
  BrowserRecipientStatus,
} from "../domain/BrowserRecipientPort";

export async function enrollBrowserRecipient(
  recipients: BrowserRecipientPort,
  browser: BrowserNotificationPort,
): Promise<BrowserRecipientStatus> {
  const permission = await browser.requestPermission();
  if (!canEnrollBrowser(permission))
    throw new Error(
      hasDeniedNotifications(permission)
        ? "Notifications are blocked. Enable them in your browser settings to enroll."
        : "Notification permission was not granted.",
    );
  let credential = browser.loadCredential();
  const status = credential
    ? await recipients.getStatus(credential)
    : await recipients.createRecipient();
  if (!credential && "managementToken" in status) {
    credential = {
      recipientId: status.recipientId,
      managementToken: String(status.managementToken),
    };
    browser.saveCredential(credential);
  }
  if (!credential) throw new Error("Browser identity was not created.");
  if (!status.vapidPublicKey)
    throw new Error(
      "Push delivery is not configured. Set the server's VAPID keys before enrolling.",
    );
  return recipients.replaceSubscription(
    credential,
    await browser.subscribe(
      status.vapidPublicKey,
      shouldReplaceExpiredSubscription(status.deliveryStatus),
    ),
  );
}
