import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FolderGit2 } from "lucide-react";
import { useDaemonRegistry } from "../../features/daemon-connection/adapters/DaemonRegistryProvider";
import { HttpProjectWorkspaceAdapter } from "../../features/project-workspace/adapters/HttpProjectWorkspaceAdapter";
import { ProjectPanel } from "../../features/project-workspace/components/ProjectPanel";

function ProjectsPage() {
  const { daemons } = useDaemonRegistry();
  const workspace = useMemo(() => new HttpProjectWorkspaceAdapter(), []);

  return (
    <div className="grid gap-6">
      <div>
        <p className="portal-eyebrow">Workspace / projects</p>
        <h1 className="portal-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-[#18243a] md:text-4xl">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e6eefb] text-[#3b5f9e]"><FolderGit2 className="h-5 w-5" /></span>
          Projects
        </h1>
        <p className="mt-2 text-base leading-7 text-muted-foreground">Create workspaces, assign daemons, and start workflow runs.</p>
      </div>
      <ProjectPanel workspace={workspace} daemons={daemons} />
    </div>
  );
}

export const Route = createFileRoute("/projects/")({ component: ProjectsPage });
