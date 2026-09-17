import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { WorkflowDefinition } from "@factory/workflow";
import type { WorkflowDefinitionPort } from "../domain/WorkflowDefinitionPort";
import { WorkflowDetail } from "./WorkflowDetail";
import { DeleteWorkflowDialog } from "./DeleteWorkflowDialog";

export function WorkflowDetailPage({
  workflowId,
  workflows,
}: {
  workflowId: string;
  workflows: WorkflowDefinitionPort;
}) {
  const navigate = useNavigate();
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void workflows
      .getWorkflow(workflowId)
      .then((next) => {
        if (active) setDefinition(next);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [workflowId, workflows]);

  function requestDelete(): void {
    setDeleteError(null);
    setDeleteRequested(true);
  }

  async function publishWorkflow(): Promise<void> {
    await changeLifecycle(() => workflows.publishWorkflow(workflowId));
  }

  async function unpublishWorkflow(): Promise<void> {
    await changeLifecycle(() => workflows.unpublishWorkflow(workflowId));
  }

  async function changeLifecycle(
    action: () => Promise<WorkflowDefinition>,
  ): Promise<void> {
    setLifecycleBusy(true);
    setLifecycleError(null);
    try {
      setDefinition(await action());
    } catch (failure) {
      setLifecycleError(
        failure instanceof Error ? failure.message : "Could not update workflow status.",
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function deleteWorkflow(): Promise<void> {
    if (!definition) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await workflows.deleteWorkflow(definition.workflowId);
      await navigate({ to: "/workflows" });
    } catch (failure) {
      setDeleteError(
        failure instanceof Error ? failure.message : "Could not delete workflow.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="grid gap-3">
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      {definition ? (
        <>
          <WorkflowDetail
            definition={definition}
            onDelete={requestDelete}
            onPublish={() => void publishWorkflow()}
            onUnpublish={() => void unpublishWorkflow()}
            lifecycleBusy={lifecycleBusy}
            lifecycleError={lifecycleError}
          />
          {deleteRequested ? (
            <DeleteWorkflowDialog
              workflowName={definition.name}
              isDeleting={isDeleting}
              deleteError={deleteError}
              onConfirm={() => void deleteWorkflow()}
              onCancel={() => setDeleteRequested(false)}
            />
          ) : null}
        </>
      ) : (
        <p role="status">Loading workflow…</p>
      )}
    </div>
  );
}
