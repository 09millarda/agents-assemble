import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HttpProjectWorkspaceAdapter } from "../../../features/project-workspace/adapters/HttpProjectWorkspaceAdapter";
import { ProjectWorkflowDetail } from "../../../features/project-workspace/adapters/ProjectWorkflowDetail";
import { HttpWorkflowRunAdapter } from "../../../features/workflow-run/adapters/HttpWorkflowRunAdapter";

function ProjectWorkflowDetailPage() {
  const { projectId } = Route.useParams();
  const workspace = useMemo(() => new HttpProjectWorkspaceAdapter(), []);
  const runs = useMemo(() => new HttpWorkflowRunAdapter(), []);

  return <ProjectWorkflowDetail workspace={workspace} runs={runs} projectId={projectId} />;
}

export const Route = createFileRoute("/projects/$projectId/")({
  component: ProjectWorkflowDetailPage,
});
