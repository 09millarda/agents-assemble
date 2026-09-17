import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";

export const DELETE_WORKFLOW_CONFIRM_TEXT = "delete";

type DeleteWorkflowConfirmationProps = {
  workflowName: string;
  isDeleting: boolean;
  deleteError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteWorkflowConfirmation({
  workflowName,
  isDeleting,
  deleteError,
  onConfirm,
  onCancel,
}: DeleteWorkflowConfirmationProps) {
  const [confirmText, setConfirmText] = useState("");
  const canConfirm =
    confirmText.trim().toLowerCase() === DELETE_WORKFLOW_CONFIRM_TEXT &&
    !isDeleting;

  return (
    <div aria-label={"Delete " + workflowName}>
      <DialogHeader>
        <DialogTitle className="text-red-900">
          Delete {workflowName}?
        </DialogTitle>
        <DialogDescription className="text-red-800">
          This permanently deletes this workflow and removes it from every
          project. Existing runs keep their frozen workflow definition.
        </DialogDescription>
      </DialogHeader>
      <label className="mt-4 block text-sm text-red-900">
        Type <code className="rounded bg-white px-1 font-mono">delete</code>{" "}
        to continue.
        <Input
          aria-label="Type delete to continue"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder={DELETE_WORKFLOW_CONFIRM_TEXT}
          className="mt-1 bg-white"
        />
      </label>
      {deleteError ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {deleteError}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isDeleting}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onConfirm}
          disabled={!canConfirm}
        >
          {isDeleting ? "Deleting…" : "Delete workflow"}
        </Button>
      </div>
    </div>
  );
}

export function DeleteWorkflowDialog(props: DeleteWorkflowConfirmationProps) {
  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open && !props.isDeleting) props.onCancel();
      }}
    >
      <DialogContent
        aria-label={"Delete " + props.workflowName}
        className="border-red-200 bg-red-50"
      >
        <DeleteWorkflowConfirmation {...props} />
      </DialogContent>
    </Dialog>
  );
}
