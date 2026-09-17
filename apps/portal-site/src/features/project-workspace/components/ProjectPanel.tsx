import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FolderGit2, Plus } from "lucide-react";
import type { DaemonSummary, ProjectInfo } from "@factory/shared-domain";
import type { ProjectWorkspacePort } from "../domain/ProjectWorkspacePort";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { useToast } from "../../../components/ui/toast";
import { HttpProjectWorkspaceAdapter } from "../adapters/HttpProjectWorkspaceAdapter";
import { useMemo } from "react";

export function ProjectPanel({
  workspace,
  daemons,
}: {
  workspace: ProjectWorkspacePort;
  daemons: DaemonSummary[];
}) {
  const { notify } = useToast();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [name, setName] = useState("");
  const [absolutePath, setAbsolutePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const next = await workspace.listProjects();
        if (!cancelled) setProjects(next);
      } catch (thrown) {
        if (!cancelled)
          setError(
            thrown instanceof Error
              ? thrown.message
              : "Failed to load projects.",
          );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  async function handleCreate() {
    setError(null);
    try {
      const created = await workspace.createProject({ name, absolutePath });
      setProjects((previous) => [...previous, created]);
      setName("");
      setAbsolutePath("");
      setDialogOpen(false);
      notify("Project created", created.name);
    } catch (thrown) {
      setError(
        thrown instanceof Error ? thrown.message : "Failed to create project.",
      );
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {projects.length} workspace{projects.length === 1 ? "" : "s"}
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" /> New project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create project workspace</DialogTitle>
              <DialogDescription>
                Point the factory at an absolute checkout path on the daemon
                machine.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm font-medium">
                Project name
                <Input
                  aria-label="Project name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="site"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Absolute path
                <Input
                  aria-label="Project path"
                  value={absolutePath}
                  onChange={(event) => setAbsolutePath(event.target.value)}
                  placeholder="/tmp/checkout"
                />
              </label>
              <Button type="button" onClick={() => void handleCreate()}>
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No project workspaces yet</CardTitle>
            <CardDescription>
              Create one, enable workflows for it, then start a run.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => {
            const daemonName =
              daemons.find((daemon) => daemon.daemonId === project.daemonId)
                ?.machineName ??
              project.daemonId ??
              "Unassigned";
            return (
              <Card key={project.projectId}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FolderGit2 className="h-4 w-4 text-slate-400" />
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.projectId }}
                      className="hover:underline"
                    >
                      {project.name}
                    </Link>
                  </CardTitle>
                  <CardDescription className="font-mono">
                    {project.absolutePath}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant={project.daemonId ? "success" : "secondary"}>
                      {daemonName}
                    </Badge>
                    {project.blockedReason ? (
                      <Badge variant="destructive">blocked</Badge>
                    ) : null}
                    <Badge variant="secondary">
                      {project.enabledWorkflowIds.length} workflows enabled
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: project.projectId }}
                      >
                        Open
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProjectPanelWithDefaultWorkspace({
  daemons,
}: {
  daemons: DaemonSummary[];
}) {
  const workspace = useMemo(() => new HttpProjectWorkspaceAdapter(), []);
  return <ProjectPanel workspace={workspace} daemons={daemons} />;
}
