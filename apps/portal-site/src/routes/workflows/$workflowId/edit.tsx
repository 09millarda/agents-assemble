import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HttpWorkflowDefinitionAdapter } from "../../../features/workflow-definition/adapters/HttpWorkflowDefinitionAdapter";
import { WorkflowEditorPage } from "../../../features/workflow-definition/adapters/WorkflowEditorPage";

function EditWorkflowPage() {
  const { workflowId } = Route.useParams();
  const workflows = useMemo(() => new HttpWorkflowDefinitionAdapter(), []);
  return <WorkflowEditorPage workflowId={workflowId} workflows={workflows} />;
}

export const Route = createFileRoute("/workflows/$workflowId/edit")({
  component: EditWorkflowPage,
});
