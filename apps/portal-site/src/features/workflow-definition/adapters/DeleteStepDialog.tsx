import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";

export function DeleteStepConfirmation({
  stepName,
  onConfirm,
  onCancel,
}: {
  stepName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <DialogHeader>
        <DialogTitle>Delete step?</DialogTitle>
        <DialogDescription>
          Deleting “{stepName}” clears handoffs that point to it. The change remains a draft until you save the workflow.
        </DialogDescription>
      </DialogHeader>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="destructive" onClick={onConfirm}>Delete step</Button>
      </div>
    </div>
  );
}

export function DeleteStepDialog({
  stepName,
  open,
  onConfirm,
  onCancel,
}: {
  stepName: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <DialogContent>
        <DeleteStepConfirmation stepName={stepName} onConfirm={onConfirm} onCancel={onCancel} />
      </DialogContent>
    </Dialog>
  );
}
