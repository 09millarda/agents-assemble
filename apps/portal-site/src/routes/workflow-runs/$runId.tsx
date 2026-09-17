import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HttpWorkflowRunAdapter } from "../../features/workflow-run/adapters/HttpWorkflowRunAdapter";
import { WorkflowRunDetail } from "../../features/workflow-run/adapters/WorkflowRunDetail";
function RunPage() {
  const { runId } = Route.useParams();
  const runs = useMemo(() => new HttpWorkflowRunAdapter(), []);
  return <WorkflowRunDetail runId={runId} runs={runs} />;
}
export const Route = createFileRoute("/workflow-runs/$runId")({
  component: RunPage,
});
