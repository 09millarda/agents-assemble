import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ProjectInfo } from "@factory/shared-domain";
import { isWorkflowPublished, type WorkflowDefinition } from "@factory/workflow";
import { ArrowLeft, Play } from "lucide-react";
import type { ProjectWorkspacePort } from "../domain/ProjectWorkspacePort";
import { startWorkflowRun } from "../application/startWorkflowRun";
import type { WorkflowDefinitionPort } from "../../workflow-definition/domain/WorkflowDefinitionPort";
import type { WorkflowRunPort } from "../../workflow-run/domain/WorkflowRunPort";
import { BrowserNotificationAdapter } from "../../browser-recipient/adapters/BrowserNotificationAdapter";
import { HttpBrowserRecipientAdapter } from "../../browser-recipient/adapters/HttpBrowserRecipientAdapter";
import { Button } from "../../../components/ui/button";
import { Card, CardDescription, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { NotificationEnrollment } from "../../browser-recipient/adapters/NotificationEnrollment";
import { Skeleton } from "../../../components/ui/skeleton";
import { Textarea } from "../../../components/ui/textarea";

const selectClass =
  "w-full rounded-xl border border-input bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface StartWorkflowRunFormProps {
  project: ProjectInfo;
  definitions: WorkflowDefinition[];
  selectedWorkflowId: string;
  kickoffPrompt: string;
  branch: string;
  notifyBrowser: boolean;
  busy: boolean;
  onWorkflowChange: (workflowId: string) => void;
  onKickoffPromptChange: (prompt: string) => void;
  onBranchChange: (branch: string) => void;
  onNotifyBrowserChange: (notify: boolean) => void;
  onStart: () => void;
}

export function StartWorkflowRunForm({
  project,
  definitions,
  selectedWorkflowId,
  kickoffPrompt,
  branch,
  notifyBrowser,
  busy,
  onWorkflowChange,
  onKickoffPromptChange,
  onBranchChange,
  onNotifyBrowserChange,
  onStart,
}: StartWorkflowRunFormProps) {
  const enabledDefinitions = definitions.filter((definition) =>
    project.enabledWorkflowIds.includes(definition.workflowId) &&
    isWorkflowPublished(definition.status),
  );

  return (
    <Card className="grid gap-4 p-5">
      <div>
        <CardTitle className="text-lg">Start a run</CardTitle>
        <CardDescription className="mt-1">
          Choose an enabled Workflow and provide optional context for the first activity.
        </CardDescription>
      </div>
      <label className="grid gap-1.5 text-sm font-semibold">
        Workflow
        <select
          className={selectClass}
          value={selectedWorkflowId}
          onChange={(event) => onWorkflowChange(event.target.value)}
          aria-label="Workflow"
        >
          <option value="">Choose enabled workflow</option>
          {enabledDefinitions.map((definition) => (
            <option key={definition.workflowId} value={definition.workflowId}>
              {definition.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-semibold">
        Optional kickoff prompt
        <Textarea
          value={kickoffPrompt}
          onChange={(event) => onKickoffPromptChange(event.target.value)}
          placeholder="Leave blank to let requirements open the interview."
        />
      </label>
      <label className="grid gap-1.5 text-sm font-semibold">
        Local starting branch (optional)
        <Input
          value={branch}
          onChange={(event) => onBranchChange(event.target.value)}
          placeholder="Project's current branch"
        />
      </label>
      <p className="text-sm leading-6 text-muted-foreground">
        The selected branch is pinned to a commit. Existing uncommitted edits stay outside the run.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={notifyBrowser}
          onChange={(event) => onNotifyBrowserChange(event.target.checked)}
        />
        Notify this browser when enrolled
      </label>
      <div>
        <Button
          type="button"
          disabled={busy || !selectedWorkflowId || !project.daemonId}
          onClick={onStart}
        >
          <Play className="h-4 w-4" /> Start run
        </Button>
      </div>
    </Card>
  );
}

export function StartWorkflowRun({
  workspace,
  workflows,
  runs,
  projectId,
}: {
  workspace: ProjectWorkspacePort;
  workflows: WorkflowDefinitionPort;
  runs: WorkflowRunPort;
  projectId: string;
}) {
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [kickoffPrompt, setKickoffPrompt] = useState("");
  const [branch, setBranch] = useState("");
  const [notifyBrowser, setNotifyBrowser] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const lastStart = useRef<{ payload: string; requestId: string } | null>(null);
  const starting = useRef(false);
  const browser = useMemo(() => new BrowserNotificationAdapter(), []);
  const recipients = useMemo(() => new HttpBrowserRecipientAdapter(), []);

  useEffect(() => {
    let active = true;

    async function loadStartRunPage() {
      try {
        const [projects, nextDefinitions] = await Promise.all([
          workspace.listProjects(),
          workflows.listWorkflows(),
        ]);
        if (!active) return;
        const nextProject = projects.find((candidate) => candidate.projectId === projectId) ?? null;
        setProject(nextProject);
        setDefinitions(nextDefinitions);
        setSelectedWorkflowId(nextProject?.enabledWorkflowIds[0] ?? "");
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Could not load project.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadStartRunPage();
    return () => {
      active = false;
    };
  }, [projectId, workspace, workflows]);

  async function start() {
    if (starting.current || !project) return;
    starting.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await startWorkflowRun({
        runs,
        browser,
        recipients,
        navigation: {
          openRun: async (runId, projectId) => {
            await navigate({
              to: "/projects/$projectId/runs/$runId",
              params: { projectId, runId },
            });
          },
        },
        resolveRequestId: (input) => {
          const payload = JSON.stringify(input);
          const requestId =
            lastStart.current?.payload === payload
              ? lastStart.current.requestId
              : crypto.randomUUID();
          lastStart.current = { payload, requestId };
          return requestId;
        },
        projectId,
        workflowId: selectedWorkflowId,
        kickoffPrompt,
        branch,
        notifyBrowser,
      });
      lastStart.current = null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start run.");
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }

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

  return (
    <div className="grid gap-7">
      <header className="grid gap-4">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#45659a] hover:text-[#18243a]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to project
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="portal-eyebrow">Project / new run</p>
            <h1 className="portal-display mt-2 truncate text-3xl font-bold tracking-tight text-[#18243a] md:text-4xl">
              Start a run
            </h1>
            <p className="mt-2 text-base leading-7 text-muted-foreground">{project.name}</p>
            <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{project.absolutePath}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant={project.blockedReason ? "destructive" : "success"}>
                {project.blockedReason ? "Blocked" : "Ready to run"}
              </Badge>
              <Badge variant="secondary">
                {project.daemonId ? "Daemon assigned" : "No daemon assigned"}
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {project.blockedReason ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {project.blockedReason}
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
        </p>
      ) : null}

      <div className="grid gap-4">
        <StartWorkflowRunForm
          project={project}
          definitions={definitions}
          selectedWorkflowId={selectedWorkflowId}
          kickoffPrompt={kickoffPrompt}
          branch={branch}
          notifyBrowser={notifyBrowser}
          busy={busy}
          onWorkflowChange={setSelectedWorkflowId}
          onKickoffPromptChange={setKickoffPrompt}
          onBranchChange={setBranch}
          onNotifyBrowserChange={setNotifyBrowser}
          onStart={() => void start()}
        />
        <NotificationEnrollment />
      </div>
    </div>
  );
}
