import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Workflow as WorkflowIcon } from "lucide-react";
import type { WorkflowCatalogFilters, WorkflowDefinition } from "@factory/workflow";
import type { WorkflowDefinitionPort } from "../domain/WorkflowDefinitionPort";
import { CreateWorkflowDialog } from "./CreateWorkflowDialog";
import { WorkflowList } from "./WorkflowList";
import { DeleteWorkflowDialog } from "./DeleteWorkflowDialog";

export function WorkflowManagement({ workflows }: { workflows: WorkflowDefinitionPort }) {
  const navigate = useNavigate();
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorkflowDefinition | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [filters, setFilters] = useState<WorkflowCatalogFilters>({ tags: [] });
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void workflows
      .listWorkflows(filters)
      .then((next) => {
        if (active) {
          setDefinitions(next);
          setAvailableTags((current) =>
            [...new Set([...current, ...next.flatMap((definition) => definition.tags)])].sort(),
          );
        }
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [filters, workflows]);

  async function createWorkflow(definition: WorkflowDefinition) {
    setError(null);
    const created = await workflows.createWorkflow(definition);
    setDefinitions((current) => [...current, created]);
    setAvailableTags((current) => [...new Set([...current, ...created.tags])].sort());
    await navigate({ to: "/workflows/$workflowId", params: { workflowId: created.workflowId } });
  }

  function requestDelete(definition: WorkflowDefinition): void {
    setDeleteError(null);
    setPendingDelete(definition);
  }

  async function confirmDeleteWorkflow(): Promise<void> {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await workflows.deleteWorkflow(pendingDelete.workflowId);
      setDefinitions((current) =>
        current.filter(
          (definition) => definition.workflowId !== pendingDelete.workflowId,
        ),
      );
      setPendingDelete(null);
    } catch (failure) {
      setDeleteError(
        failure instanceof Error ? failure.message : "Could not delete workflow.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="grid gap-6">
      <header>
        <p className="portal-eyebrow">Workspace / orchestration</p>
        <h1 className="portal-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-[#18243a] md:text-4xl">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fff3d9] text-[#aa6816]"><WorkflowIcon className="h-5 w-5" /></span>
          Workflows
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">Create reusable workflows and enable them separately for each project.</p>
        <div className="mt-5">
          <CreateWorkflowDialog onCreate={createWorkflow} />
        </div>
      </header>

      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <WorkflowList
        definitions={definitions}
        onDelete={requestDelete}
        filters={filters}
        availableTags={availableTags}
        onFiltersChange={setFilters}
      />
      {pendingDelete ? (
        <DeleteWorkflowDialog
          workflowName={pendingDelete.name}
          isDeleting={isDeleting}
          deleteError={deleteError}
          onConfirm={() => void confirmDeleteWorkflow()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
