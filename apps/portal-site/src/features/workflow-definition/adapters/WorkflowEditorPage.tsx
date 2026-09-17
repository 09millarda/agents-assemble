import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { WorkflowDefinition } from "@factory/workflow";
import type { WorkflowDefinitionPort } from "../domain/WorkflowDefinitionPort";
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
      <h1 className="text-xl font-semibold">Edit workflow</h1>
      {error ? (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      ) : null}
      {definition ? (
        <WorkflowEditor
          key={workflowId}
          definition={definition}
          onSave={async (draft) => {
            setDefinition(await saveWorkflowDraft(workflows, draft));
          }}
        />
      ) : (
        <p role="status">Loading workflow…</p>
      )}
    </div>
  );
}
