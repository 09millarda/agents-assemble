import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";

export interface WorkflowMetadata {
  name: string;
  description: string;
}

export function WorkflowMetadataDialog({
  metadata,
  onSave,
}: {
  metadata: WorkflowMetadata;
  onSave: (metadata: WorkflowMetadata) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(metadata);

  function openEditor(): void {
    setDraft(metadata);
    setOpen(true);
  }

  function closeEditor(): void {
    setOpen(false);
  }

  function saveChanges(): void {
    if (!draft.name.trim()) return;
    onSave({ name: draft.name, description: draft.description });
    closeEditor();
  }

  useEffect(() => {
    if (!open) setDraft(metadata);
  }, [metadata, open]);

  return (
    <>
      <section className="rounded-2xl border border-border/80 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <dl className="grid min-w-0 gap-3">
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Workflow name</dt>
              <dd className="mt-1 truncate text-lg font-bold tracking-tight text-[#18243a]">{metadata.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Workflow description</dt>
              <dd className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                {metadata.description.trim() || "No description yet."}
              </dd>
            </div>
          </dl>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Edit workflow metadata"
            title="Edit workflow metadata"
            onClick={openEditor}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit workflow metadata</DialogTitle>
            <DialogDescription>
              Update the name and short description shown throughout the portal.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm font-medium">
              Workflow name
              <Input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                aria-invalid={!draft.name.trim()}
                autoFocus
              />
              {!draft.name.trim() ? <span className="text-xs font-normal text-red-600">Workflow name is required.</span> : null}
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Workflow description
              <Textarea
                rows={4}
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="What is this workflow for?"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeEditor}>Cancel</Button>
              <Button type="button" disabled={!draft.name.trim()} onClick={saveChanges}>Save changes</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
