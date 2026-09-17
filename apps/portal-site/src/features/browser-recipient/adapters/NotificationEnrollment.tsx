import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { enrollBrowserRecipient } from "../application/enrollBrowserRecipient";
import type { BrowserRecipientStatus } from "../domain/BrowserRecipientPort";
import { BrowserNotificationAdapter } from "./BrowserNotificationAdapter";
import { HttpBrowserRecipientAdapter } from "./HttpBrowserRecipientAdapter";

export function NotificationEnrollment() {
  const browser = useMemo(() => new BrowserNotificationAdapter(), []);
  const recipients = useMemo(() => new HttpBrowserRecipientAdapter(), []);
  const [status, setStatus] = useState<BrowserRecipientStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const credential = browser.loadCredential();
    async function refresh() {
      if (!credential) return;
      try {
        const next = await recipients.getStatus(credential);
        if (active) setStatus(next);
      } catch (error) {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not read delivery status.",
          );
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [browser, recipients, status?.recipientId]);
  async function enroll() {
    setBusy(true);
    setMessage(null);
    try {
      setStatus(await enrollBrowserRecipient(recipients, browser));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Notification enrollment failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    const credential = browser.loadCredential();
    if (!credential) return;
    setBusy(true);
    try {
      setStatus(await recipients.replaceSubscription(credential, null));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not disable delivery.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="grid gap-2 rounded-md border bg-white p-3"
      aria-label="Browser notifications"
    >
      <h2 className="text-sm font-semibold">Browser notifications</h2>
      <p className="text-xs text-slate-500">
        Receive questions, approvals and results for runs started in this
        browser, including when all portal tabs are closed. Browser and
        operating-system availability affect delivery.
      </p>
      <p className="text-xs" role="status">
        {status
          ? `${status.active ? "Enrolled" : "Not enrolled"} · ${status.deliveryStatus}`
          : "Not enrolled"}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void enroll()}
        >
          {status?.active ? "Refresh subscription" : "Enable notifications"}
        </Button>
        {status?.active ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void disable()}
          >
            Disable
          </Button>
        ) : null}
      </div>
      {status?.lastDeliveryError ? (
        <p className="text-xs text-red-700">
          Last delivery: {status.lastDeliveryError}
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="text-xs text-red-700">
          {message}
        </p>
      ) : null}
    </section>
  );
}
