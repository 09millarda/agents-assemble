import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";

export const REMOVE_CONFIRM_TEXT = "confirm";

export function RemoveDaemonDialog({
  machineName,
  isConfirming,
  confirmError,
  onConfirm,
  onCancel,
}: {
  machineName: string;
  isConfirming: boolean;
  confirmError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = confirmText.trim().toLowerCase() === REMOVE_CONFIRM_TEXT && !isConfirming;

  return (
    <div role="dialog" aria-label={`Remove ${machineName}`} className="rounded-md border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-semibold text-red-900">Remove {machineName}?</p>
      <p className="mt-1 text-sm text-red-800">
        This disconnects the machine straight away and takes it out of your organisation, so it can no longer receive
        work from here. To use this machine again later, just sign it in fresh and it will show up as a new daemon.
      </p>
      <label className="mt-3 block text-sm text-red-900">
        Type <code className="rounded bg-white px-1 font-mono">{REMOVE_CONFIRM_TEXT}</code> to remove it.
        <Input
          aria-label="Type confirm to remove"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder={REMOVE_CONFIRM_TEXT}
          className="mt-1 bg-white"
        />
      </label>
      {confirmError ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {confirmError}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isConfirming}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={!canConfirm}>
          {isConfirming ? "Removing…" : "Remove"}
        </Button>
      </div>
    </div>
  );
}
