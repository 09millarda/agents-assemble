import { useState } from "react";
import type { WorkflowDefinition } from "@factory/workflow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { WorkflowTagInput } from "./WorkflowTagInput";
import { createWorkflowDraft } from "../application/createWorkflowDraft";
import {
  createWorkflowFromTemplate,
  WORKFLOW_TEMPLATES,
  type WorkflowTemplateId,
} from "../domain/workflowTemplates";

const DEFAULT_TEMPLATE_ID: WorkflowTemplateId = "feature-building";

export function WorkflowCreationForm({
  onCreate,
  onCancel,
}: {
  onCreate: (definition: WorkflowDefinition) => Promise<void>;
  onCancel: () => void;
}) {
  const defaultWorkflow = createWorkflowFromTemplate(DEFAULT_TEMPLATE_ID);
  const [templateId, setTemplateId] = useState<WorkflowTemplateId>(DEFAULT_TEMPLATE_ID);
  const [name, setName] = useState(defaultWorkflow.name);
  const [description, setDescription] = useState(defaultWorkflow.description);
  const [tags, setTags] = useState(defaultWorkflow.tags);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function chooseTemplate(nextTemplateId: WorkflowTemplateId) {
    const nextWorkflow = createWorkflowFromTemplate(nextTemplateId);
    setTemplateId(nextTemplateId);
    setName(nextWorkflow.name);
    setDescription(nextWorkflow.description);
    setTags(nextWorkflow.tags);
  }

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(
        createWorkflowDraft(
          templateId,
          crypto.randomUUID(),
          name.trim(),
          description.trim(),
          tags,
        ),
      );
      onCancel();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create workflow.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Choose a template</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Workflow template">
          {WORKFLOW_TEMPLATES.map((template) => (
            <label
              key={template.id}
              className={`grid cursor-pointer gap-1 rounded-xl border p-3 transition-colors ${templateId === template.id ? "border-[#45659a] bg-[#edf2f8]" : "border-border bg-white hover:border-[#bdcbe0]"}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-[#18243a]">
                <input
                  type="radio"
                  name="workflow-template"
                  value={template.id}
                  checked={templateId === template.id}
                  onChange={() => chooseTemplate(template.id)}
                />
                {template.name}
              </span>
              <span className="text-xs leading-5 text-muted-foreground">{template.summary}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1.5 text-sm font-semibold">
        Workflow name
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this workflow"
          aria-required="true"
        />
      </label>
      <label className="grid gap-1.5 text-sm font-semibold">
        Workflow tags
        <WorkflowTagInput tags={tags} onChange={setTags} />
      </label>
      <label className="grid gap-1.5 text-sm font-semibold">
        Workflow description
        <Textarea
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What is this workflow for?"
        />
      </label>
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create workflow"}
        </Button>
      </div>
    </form>
  );
}

export function CreateWorkflowDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreate: (definition: WorkflowDefinition) => Promise<void>;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;

  function changeOpen(nextOpen: boolean) {
    onOpenChange?.(nextOpen);
    if (open === undefined) setInternalOpen(nextOpen);
  }

  return (
    <Dialog open={isOpen} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button>Create workflow</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create workflow</DialogTitle>
          <DialogDescription>Start from a blueprint, then give the workflow a name and a short description.</DialogDescription>
        </DialogHeader>
        <WorkflowCreationForm
          key={isOpen ? "open" : "closed"}
          onCreate={onCreate}
          onCancel={() => changeOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
