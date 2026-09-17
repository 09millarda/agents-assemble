import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ProjectInfo } from "@factory/shared-domain";
import type { WorkflowRun } from "@factory/workflow";
import { ArrowLeft, Play, Settings } from "lucide-react";
import type { ProjectWorkspacePort } from "../domain/ProjectWorkspacePort";
import type { WorkflowRunPort } from "../../workflow-run/domain/WorkflowRunPort";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { ProjectRuns } from "./ProjectRuns";

export function ProjectWorkflowDetailView({
  project,
  history,
  message,
}: {
  project: ProjectInfo;
  history: WorkflowRun[];
  message: string | null;
}) {
  const projectId = project.projectId;

  return (
    <div className="grid gap-7">
      <header className="grid gap-4">
        <Link to="/projects" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#45659a] hover:text-[#18243a]">
          <ArrowLeft className="h-4 w-4" /> Back to projects
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="portal-eyebrow">Project / runs</p>
            <h1 className="portal-display mt-2 truncate text-3xl font-bold tracking-tight text-[#18243a] md:text-4xl">{project.name}</h1>
            <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{project.absolutePath}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant={project.blockedReason ? "destructive" : "success"}>
                {project.blockedReason ? "Blocked" : "Ready to run"}
              </Badge>
              <Badge variant="secondary">
                {project.daemonId ? "Daemon assigned" : "No daemon assigned"}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" asChild>
              <Link to="/projects/$projectId/settings" params={{ projectId }} aria-label="Open project settings" title="Project settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild>
              <Link to="/projects/$projectId/runs/new" params={{ projectId }}>
                <Play className="h-4 w-4" /> Start run
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {project.blockedReason ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{project.blockedReason}</p>
      ) : null}
      {message ? <p role="status" className="rounded-2xl border border-[#cce7d7] bg-[#f1fbf5] p-4 text-sm text-[#226342]">{message}</p> : null}

      <ProjectRuns runs={history} />
    </div>
  );
}

export function ProjectWorkflowDetail({
  workspace,
  runs,
  projectId,
}: {
  workspace: ProjectWorkspacePort;
  runs: WorkflowRunPort;
  projectId: string;
}) {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [history, setHistory] = useState<WorkflowRun[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let refreshInFlight = false;

    async function loadProject() {
      try {
        const [projects, nextRuns] = await Promise.all([
          workspace.listProjects(),
          runs.listRuns(projectId),
        ]);
        if (!active) return;
        const nextProject = projects.find((candidate) => candidate.projectId === projectId) ?? null;
        setProject(nextProject);
        setHistory(nextRuns);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Could not load project.");
      } finally {
        if (active) setLoading(false);
      }
    }

    async function refreshRuns() {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const nextRuns = await runs.listRuns(projectId);
        if (active) setHistory(nextRuns);
      } catch {
        // Keep the last known runs visible when a background refresh fails.
      } finally {
        refreshInFlight = false;
      }
    }

    void loadProject();
    const timer = window.setInterval(() => void refreshRuns(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId, runs, workspace]);

  if (loading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16 w-80" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="grid gap-2">
        <h1 className="text-xl font-semibold">Project not found</h1>
        {message ? <p role="alert" className="text-sm text-red-700">{message}</p> : null}
      </div>
    );
  }

  return <ProjectWorkflowDetailView project={project} history={history} message={message} />;
}
