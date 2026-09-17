import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HttpWorkflowDefinitionAdapter } from "../../features/workflow-definition/adapters/HttpWorkflowDefinitionAdapter";
import { WorkflowManagement } from "../../features/workflow-definition/adapters/WorkflowManagement";
function WorkflowsPage() {
  const workflows = useMemo(() => new HttpWorkflowDefinitionAdapter(), []);
  return <WorkflowManagement workflows={workflows} />;
}
export const Route = createFileRoute("/workflows/")({
  component: WorkflowsPage,
});
