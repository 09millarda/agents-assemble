import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HttpWorkflowDefinitionAdapter } from "../../../features/workflow-definition/adapters/HttpWorkflowDefinitionAdapter";
import { WorkflowDetailPage } from "../../../features/workflow-definition/adapters/WorkflowDetailPage";

function WorkflowDetailsPage() {
  const { workflowId } = Route.useParams();
  const workflows = useMemo(() => new HttpWorkflowDefinitionAdapter(), []);
  return <WorkflowDetailPage workflowId={workflowId} workflows={workflows} />;
}

export const Route = createFileRoute("/workflows/$workflowId/")({
  component: WorkflowDetailsPage,
});
