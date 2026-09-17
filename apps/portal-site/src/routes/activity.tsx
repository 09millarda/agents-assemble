import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Activity as ActivityIcon } from "lucide-react";
import type { ProjectInfo } from "@factory/shared-domain";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { useDaemonRegistry } from "../features/daemon-connection/adapters/DaemonRegistryProvider";
import { HttpProjectWorkspaceAdapter } from "../features/project-workspace/adapters/HttpProjectWorkspaceAdapter";

function ActivityPage() {
  const { daemons, isLoading: isLoadingDaemons } = useDaemonRegistry();
  const workspace = useMemo(() => new HttpProjectWorkspaceAdapter(), []);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void workspace.listProjects()
      .then((nextProjects) => {
        if (!cancelled) setProjects(nextProjects);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  return (
    <div className="grid gap-6">
      <div>
        <p className="portal-eyebrow">Workspace / pulse</p>
        <h1 className="portal-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-[#18243a] md:text-4xl">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fff3d9] text-[#aa6816]"><ActivityIcon className="h-5 w-5" /></span>
          Activity
        </h1>
        <p className="mt-2 text-base leading-7 text-muted-foreground">
          Follow workflow runs, conversations, and daemon availability.
        </p>
      </div>
      {isLoadingDaemons || isLoadingProjects ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="border-b border-border/70 bg-[#fbfcfd]">
              <CardTitle>Workflow runs by project</CardTitle>
              <CardDescription>{projects.length} workspace(s) tracked</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {projects.length === 0 ? (
                <p className="text-sm leading-6 text-muted-foreground">No projects yet. Create one under Projects to start a run.</p>
              ) : (
                projects.map((project) => (
                  <div key={project.projectId} className="flex items-center justify-between rounded-xl border border-border/70 bg-[#fbfcfd] px-3 py-3 text-sm">
                    <div>
                      <p className="font-medium">{project.name}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{project.absolutePath}</p>
                    </div>
                    {project.blockedReason ? <Badge variant="destructive">blocked</Badge> : <Badge variant="secondary">{project.daemonId ? "assigned" : "unassigned"}</Badge>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="border-b border-border/70 bg-[#fbfcfd]">
              <CardTitle>Daemon availability</CardTitle>
              <CardDescription>{daemons.length} daemon(s) known</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {daemons.length === 0 ? (
                <p className="text-sm leading-6 text-muted-foreground">No daemons registered. Connect a daemon to make it available for workflow runs.</p>
              ) : (
                daemons.map((daemon) => (
                  <div key={daemon.daemonId} className="flex items-center justify-between rounded-xl border border-border/70 bg-[#fbfcfd] px-3 py-3 text-sm">
                    <span className="font-medium">{daemon.machineName}</span>
                    <Badge variant={daemon.status === "online" ? "success" : "secondary"}>{daemon.status}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/activity")({ component: ActivityPage });
