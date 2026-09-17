import { useEffect, useState } from "react";
import { Link, useBlocker } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { WorkflowDefinition } from "@factory/workflow";
import type { WorkflowDefinitionPort } from "../domain/WorkflowDefinitionPort";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import { WorkflowEditor } from "./WorkflowEditor";
import { saveWorkflowDraft } from "../application/saveWorkflowDraft";
export function WorkflowEditorPage({
  workflowId,
  workflows,
}: {
  workflowId: string;
  workflows: WorkflowDefinitionPort;
}) {
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: isDirty,
    withResolver: true,
  });
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
  return (
    <div className="grid gap-3">
      <Link to="/workflows/$workflowId" params={{ workflowId }} className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#45659a] hover:text-[#18243a]">
        <ArrowLeft className="h-4 w-4" /> Back to workflow
      </Link>
      {error ? (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      ) : null}
      {definition ? (
        <WorkflowEditor
          key={workflowId}
          definition={definition}
          onDirtyChange={setIsDirty}
          onSave={async (draft) => {
            const savedDefinition = await saveWorkflowDraft(workflows, draft);
            setDefinition(savedDefinition);
            return savedDefinition;
          }}
        />
      ) : (
        <p role="status">Loading workflow…</p>
      )}
      {blocker.status === "blocked" ? (
        <UnsavedChangesDialog
          open
          onLeave={blocker.proceed}
          onStay={blocker.reset}
        />
      ) : null}
    </div>
  );
}
