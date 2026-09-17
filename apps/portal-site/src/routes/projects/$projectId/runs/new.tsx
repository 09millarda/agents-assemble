import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HttpProjectWorkspaceAdapter } from "../../../../features/project-workspace/adapters/HttpProjectWorkspaceAdapter";
import { StartWorkflowRun } from "../../../../features/project-workspace/adapters/StartWorkflowRun";
import { HttpWorkflowDefinitionAdapter } from "../../../../features/workflow-definition/adapters/HttpWorkflowDefinitionAdapter";
import { HttpWorkflowRunAdapter } from "../../../../features/workflow-run/adapters/HttpWorkflowRunAdapter";

function NewWorkflowRunPage() {
  const { projectId } = Route.useParams();
  const workspace = useMemo(() => new HttpProjectWorkspaceAdapter(), []);
  const workflows = useMemo(() => new HttpWorkflowDefinitionAdapter(), []);
  const runs = useMemo(() => new HttpWorkflowRunAdapter(), []);

  return (
    <StartWorkflowRun
      workspace={workspace}
      workflows={workflows}
      runs={runs}
      projectId={projectId}
    />
  );
}

export const Route = createFileRoute("/projects/$projectId/runs/new")({
  component: NewWorkflowRunPage,
});
