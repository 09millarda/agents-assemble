import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { DaemonSummary, ProjectInfo } from "@factory/shared-domain";
import { isWorkflowPublished, type WorkflowDefinition } from "@factory/workflow";
import { ArrowLeft, CheckCircle2, GitBranch, HardDrive, Settings } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import type { ProjectWorkspacePort } from "../domain/ProjectWorkspacePort";

const selectClass =
  "w-full rounded-xl border border-input bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

type SettingsSection = "name" | "daemon" | "setup" | "workflows";

export function ProjectSettings({
  project: initialProject,
  daemons,
  definitions,
  workspace,
}: {
  project: ProjectInfo;
  daemons: DaemonSummary[];
  definitions: WorkflowDefinition[];
  workspace: ProjectWorkspacePort;
}) {
  const publishedDefinitions = definitions.filter((definition) => isWorkflowPublished(definition.status));
  const [project, setProject] = useState(initialProject);
  const [name, setName] = useState(initialProject.name);
  const [daemonId, setDaemonId] = useState(initialProject.daemonId ?? "");
  const [setupCommand, setSetupCommand] = useState(initialProject.setupCommand ?? "");
  const [enabledWorkflowIds, setEnabledWorkflowIds] = useState(() =>
    initialProject.enabledWorkflowIds.filter((workflowId) =>
      publishedDefinitions.some((definition) => definition.workflowId === workflowId),
    ),
  );
  const [busySection, setBusySection] = useState<SettingsSection | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function saveSection(
    section: SettingsSection,
    action: () => Promise<ProjectInfo>,
    successMessage: string,
  ) {
    setBusySection(section);
    setMessage(null);
    try {
      const updated = await action();
      setProject(updated);
      setName(updated.name);
      setDaemonId(updated.daemonId ?? "");
      setSetupCommand(updated.setupCommand ?? "");
      setEnabledWorkflowIds(updated.enabledWorkflowIds);
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save project settings.");
    } finally {
      setBusySection(null);
    }
  }

  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.projectId }}
          className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#45659a] hover:text-[#18243a]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to project
        </Link>
        <div>
          <p className="portal-eyebrow">Project / settings</p>
          <h1 className="portal-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-[#18243a] md:text-4xl">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fff3d9] text-[#aa6816]">
              <Settings className="h-5 w-5" />
            </span>
            Project settings
          </h1>
          <p className="mt-2 text-base leading-7 text-muted-foreground">
            Configure where runs execute and which Workflows this project can use.
          </p>
        </div>
      </header>

      {project.blockedReason ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {project.blockedReason}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-2xl border border-[#cce7d7] bg-[#f1fbf5] p-4 text-sm text-[#226342]">
          {message}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border/70 bg-[#fbfcfd]">
            <CardTitle className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-[#45659a]" /> Project details</CardTitle>
            <CardDescription>Set the name people see in the Portal. The local checkout path is fixed for this project.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-semibold">
              Project name
              <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Project name" />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              Project path
              <Input value={project.absolutePath} readOnly aria-label="Project path" className="bg-[#f4f7fa] font-mono text-muted-foreground" />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant={project.gitStatus === "valid" ? "success" : "warning"}>
                Git status: {project.gitStatus}
              </Badge>
              <Button
                variant="outline"
                disabled={busySection !== null}
                onClick={() => void saveSection("name", () => workspace.setProjectName(project.projectId, name.trim()), "Project name saved.")}
              >
                {busySection === "name" ? "Saving…" : "Save project name"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/70 bg-[#fbfcfd]">
            <CardTitle className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-[#45659a]" /> Daemon assignment</CardTitle>
            <CardDescription>Choose the Machine-Run Daemon that owns this project’s workflow executions.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-semibold">
              Machine-Run Daemon
              <select className={selectClass} value={daemonId} onChange={(event) => setDaemonId(event.target.value)} aria-label="Machine-Run Daemon">
                <option value="">Choose daemon</option>
                {daemons.map((daemon) => (
                  <option key={daemon.daemonId} value={daemon.daemonId}>
                    {daemon.displayName} · {daemon.status}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {daemons.length === 0 ? "No daemons are registered." : "Runs use this daemon’s local checkout."}
              </p>
              <Button
                variant="outline"
                disabled={busySection !== null || !daemonId}
                onClick={() => void saveSection("daemon", () => workspace.assignDaemon(project.projectId, daemonId), "Daemon assignment saved.")}
              >
                {busySection === "daemon" ? "Saving…" : "Assign daemon"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/70 bg-[#fbfcfd]">
            <CardTitle>Setup command</CardTitle>
            <CardDescription>Optional command run once in each run’s retained worktree.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-semibold">
              Optional project setup command
              <Input value={setupCommand} onChange={(event) => setSetupCommand(event.target.value)} placeholder="For example: pnpm install" />
            </label>
            <p className="text-sm leading-6 text-muted-foreground">Setup logs remain available on the run. Environment files are not copied.</p>
            <div>
              <Button
                variant="outline"
                disabled={busySection !== null}
                onClick={() => void saveSection("setup", () => workspace.setSettings(project.projectId, { setupCommand: setupCommand.trim() || null }), "Setup command saved.")}
              >
                {busySection === "setup" ? "Saving…" : "Save setup command"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/70 bg-[#fbfcfd]">
            <CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#45659a]" /> Enabled workflows</CardTitle>
            <CardDescription>Only enabled Workflows can be started from this project.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {publishedDefinitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Published Workflows are available yet.</p>
            ) : publishedDefinitions.map((definition) => (
              <label key={definition.workflowId} className="flex items-center gap-3 rounded-xl border border-border/70 bg-[#fbfcfd] px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={enabledWorkflowIds.includes(definition.workflowId)}
                  onChange={(event) => setEnabledWorkflowIds((current) => event.target.checked ? [...current, definition.workflowId] : current.filter((workflowId) => workflowId !== definition.workflowId))}
                />
                <span className="font-medium">{definition.name}</span>
                <span className="flex flex-wrap gap-1">
                  {definition.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{definition.activities.length} activities</span>
              </label>
            ))}
            <div>
              <Button
                variant="outline"
                disabled={busySection !== null}
                onClick={() => void saveSection("workflows", () => workspace.setEnabledWorkflowIds(project.projectId, enabledWorkflowIds), "Enabled Workflows saved.")}
              >
                {busySection === "workflows" ? "Saving…" : "Save enabled workflows"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
