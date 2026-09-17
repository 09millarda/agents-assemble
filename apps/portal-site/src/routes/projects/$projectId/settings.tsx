import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ProjectInfo } from "@factory/shared-domain";
import type { WorkflowDefinition } from "@factory/workflow";
import { Skeleton } from "../../../components/ui/skeleton";
import { useDaemonRegistry } from "../../../features/daemon-connection/adapters/DaemonRegistryProvider";
import { ProjectSettings } from "../../../features/project-workspace/adapters/ProjectSettings";
import { HttpProjectWorkspaceAdapter } from "../../../features/project-workspace/adapters/HttpProjectWorkspaceAdapter";
import { HttpWorkflowDefinitionAdapter } from "../../../features/workflow-definition/adapters/HttpWorkflowDefinitionAdapter";

function ProjectSettingsPage() {
  const { projectId } = Route.useParams();
  const { daemons, isLoading: isLoadingDaemons } = useDaemonRegistry();
  const workspace = useMemo(() => new HttpProjectWorkspaceAdapter(), []);
  const workflows = useMemo(() => new HttpWorkflowDefinitionAdapter(), []);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.all([
      workspace.listProjects(),
      workflows.listWorkflows(),
    ])
      .then(([projects, nextDefinitions]) => {
        if (!active) return;
        setProject(projects.find((candidate) => candidate.projectId === projectId) ?? null);
        setDefinitions(nextDefinitions);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, workspace, workflows]);

  if (loading || isLoadingDaemons) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (error) return <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!project) return <h1 className="text-xl font-semibold">Project not found</h1>;
  return <ProjectSettings project={project} daemons={daemons} definitions={definitions} workspace={workspace} />;
}

export const Route = createFileRoute("/projects/$projectId/settings")({
  component: ProjectSettingsPage,
});
