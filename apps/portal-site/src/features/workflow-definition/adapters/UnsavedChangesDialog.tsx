import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";

export function UnsavedChangesConfirmation({
  onLeave,
  onStay,
}: {
  onLeave: () => void;
  onStay: () => void;
}) {
  return (
    <div>
      <DialogHeader>
        <DialogTitle>Leave without saving?</DialogTitle>
        <DialogDescription>
          Your workflow has unsaved changes. Leaving now will discard this draft.
        </DialogDescription>
      </DialogHeader>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onStay}>Stay</Button>
        <Button type="button" variant="destructive" onClick={onLeave}>Leave without saving</Button>
      </div>
    </div>
  );
}

export function UnsavedChangesDialog({
  open,
  onLeave,
  onStay,
}: {
  open: boolean;
  onLeave: () => void;
  onStay: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onStay(); }}>
      <DialogContent>
        <UnsavedChangesConfirmation onLeave={onLeave} onStay={onStay} />
      </DialogContent>
    </Dialog>
  );
}
