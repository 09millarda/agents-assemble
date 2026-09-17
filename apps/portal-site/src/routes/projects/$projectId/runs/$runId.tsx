import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HttpProjectWorkspaceAdapter } from "../../../../features/project-workspace/adapters/HttpProjectWorkspaceAdapter";
import { HttpWorkflowRunAdapter } from "../../../../features/workflow-run/adapters/HttpWorkflowRunAdapter";
import { WorkflowRunDetail } from "../../../../features/workflow-run/adapters/WorkflowRunDetail";

function NestedRunPage() {
  const { projectId, runId } = Route.useParams();
  const runs = useMemo(() => new HttpWorkflowRunAdapter(), []);
  const workspace = useMemo(() => new HttpProjectWorkspaceAdapter(), []);
  return <WorkflowRunDetail projectId={projectId} runId={runId} runs={runs} workspace={workspace} />;
}

export const Route = createFileRoute("/projects/$projectId/runs/$runId")({
  component: NestedRunPage,
});
