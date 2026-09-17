import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { HumanInteraction, HumanResponse, WorkflowRun } from "@factory/workflow";
import { isWorkflowRunTerminal } from "@factory/workflow";
import type { RunNotification, WorkflowRunPort } from "../domain/WorkflowRunPort";
import type { ProjectWorkspacePort } from "../../project-workspace/domain/ProjectWorkspacePort";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { useToast } from "../../../components/ui/toast";
import { HumanInteractionPanel } from "./HumanInteractionPanel";
import { ReadOnlyMarkdown, RunDocuments } from "./RunDocuments";
import { RunNotifications } from "./RunNotifications";
import { WorkflowGraph, type NodeStatus } from "../../workflow-definition/adapters/WorkflowGraph";

function statusByActivityId(run: WorkflowRun): Record<string, NodeStatus> {
  const status: Record<string, NodeStatus> = {};
  for (const execution of run.executions) {
    if (execution.status === "completed") status[execution.activityId] = "done";
    else if (execution.status === "awaiting-human") status[execution.activityId] = "waiting";
    else if (execution.status === "running") status[execution.activityId] = "running";
  }
  return status;
}

function currentActivityId(run: WorkflowRun): string | null {
  const last = run.executions.at(-1);
  if (!last || ["completed", "cancelled", "failed"].includes(run.status)) return null;
  return last.activityId;
}

function isRunActive(run: WorkflowRun): boolean {
  return !isWorkflowRunTerminal(run.status);
}

function runStatusLabel(status: WorkflowRun["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "awaiting-human":
      return "Needs your input";
    case "recovery-required":
      return "Step failed";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
  }
}

function stepPosition(run: WorkflowRun): string {
  const activities = run.snapshot.activities;
  const total = activities.length;
  if (total === 0) return "No steps yet";
  const currentId = currentActivityId(run);
  if (currentId) {
    const index = activities.findIndex((activity) => activity.activityId === currentId);
    if (index >= 0) return `Step ${index + 1} of ${total} · ${activities[index]?.name ?? ""}`;
  }
  if (run.executions.length === 0) {
    const firstName = activities[0]?.name ?? "";
    return `Step 1 of ${total} · ${firstName}`;
  }
  if (run.status === "completed") return `Finished all ${total} steps`;
  const last = run.executions.at(-1);
  if (last) {
    const index = activities.findIndex((activity) => activity.activityId === last.activityId);
    if (index >= 0) return `Stopped at step ${index + 1} of ${total}`;
  }
  return `Step ${total} of ${total}`;
}

type OverviewStepState = "done" | "progress" | "needs-you" | "failed" | "stopped" | "todo";

function stepStateFor(run: WorkflowRun, activityId: string): OverviewStepState {
  const related = run.executions.filter((execution) => execution.activityId === activityId);
  const last = related.at(-1);
  if (!last) return "todo";
  switch (last.status) {
    case "completed":
      return "done";
    case "running":
      return "progress";
    case "awaiting-human":
      return "needs-you";
    case "failed":
      return "failed";
    case "cancelled":
      return "stopped";
  }
}

function stepStateLabel(state: OverviewStepState): string {
  switch (state) {
    case "done":
      return "Done";
    case "progress":
      return "In progress";
    case "needs-you":
      return "Needs you";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "todo":
      return "Not started";
  }
}

function overviewInteractionTitle(kind: HumanInteraction["kind"]): string {
  switch (kind) {
    case "question":
      return "Your answer is needed";
    case "permission":
      return "Permission needed";
    case "approval":
      return "Approval required";
    case "loop-exhaustion":
      return "Review limit reached";
    case "recovery":
      return "Step failed";
  }
}

function RunBreadcrumbs({
  projectId,
  projectName,
  runName,
}: {
  projectId: string;
  projectName: string;
  runName: string;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
        <li>
          <Link to="/projects" className="font-medium text-[#45659a] hover:text-[#18243a]">
            Projects
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="font-medium text-[#45659a] hover:text-[#18243a]"
          >
            {projectName}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="font-medium text-[#45659a] hover:text-[#18243a]"
          >
            Runs
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="max-w-60 truncate font-semibold text-slate-900">
          {runName}
        </li>
      </ol>
    </nav>
  );
}

export function OverviewActionCard({
  interaction,
  runId,
  busy,
  onRespond,
}: {
  interaction: HumanInteraction;
  runId: string;
  busy: boolean;
  onRespond: (response: HumanResponse) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const [additionalPasses, setAdditionalPasses] = useState(1);
  async function respond(action: HumanResponse["action"]) {
    await onRespond({
      runId,
      interactionId: interaction.interactionId,
      messageId: crypto.randomUUID(),
      action,
      ...(answer.trim() ? { answer: answer.trim() } : {}),
      ...(action === "extend-loop" ? { additionalPasses } : {}),
    });
  }
  return (
    <section className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4" aria-label="Needed action">
      <h2 className="font-semibold">{overviewInteractionTitle(interaction.kind)}</h2>
      <p className="whitespace-pre-wrap text-sm">{interaction.prompt}</p>
      {interaction.kind !== "permission" ? (
        <label className="grid gap-1 text-sm font-medium">
          {interaction.kind === "question" ? "Answer" : "Feedback or decision notes"}
          <Textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={3} disabled={busy} />
        </label>
      ) : (
        <p className="text-sm text-slate-600">This lets the run continue.</p>
      )}
      {interaction.kind === "loop-exhaustion" ? (
        <label className="grid gap-1 text-sm">
          Additional review passes
          <Input
            type="number"
            min={1}
            max={100}
            value={additionalPasses}
            onChange={(event) => setAdditionalPasses(Number(event.target.value))}
          />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {interaction.kind === "question" ? (
          <Button disabled={busy || !answer.trim()} onClick={() => void respond("answer")}>
            Send answer
          </Button>
        ) : null}
        {interaction.kind === "approval" ? (
          <>
            <Button disabled={busy} onClick={() => void respond("approve")}>
              Approve
            </Button>
            <Button variant="outline" disabled={busy || !answer.trim()} onClick={() => void respond("request-changes")}>
              Request changes
            </Button>
          </>
        ) : null}
        {interaction.kind === "permission" ? (
          <>
            <Button disabled={busy} onClick={() => void respond("allow-permission")}>
              Allow permission
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void respond("deny-permission")}>
              Deny permission
            </Button>
          </>
        ) : null}
        {interaction.kind === "loop-exhaustion" ? (
          <>
            <Button
              disabled={busy || !Number.isInteger(additionalPasses) || additionalPasses < 1}
              onClick={() => void respond("extend-loop")}
            >
              Authorize additional passes
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void respond("accept-findings")}>
              Accept unresolved findings and disclose them
            </Button>
          </>
        ) : null}
        {interaction.kind === "recovery" ? (
          <Button disabled={busy} onClick={() => void respond("retry")}>
            Retry step
          </Button>
        ) : null}
        <Button variant="outline" disabled={busy} onClick={() => void respond("cancel")}>
          Cancel run
        </Button>
      </div>
    </section>
  );
}

export function RunOverview({
  run,
  busy,
  onRespond,
}: {
  run: WorkflowRun;
  busy: boolean;
  onRespond: (response: HumanResponse) => Promise<void>;
}) {
  const position = stepPosition(run);
  return (
    <div className="grid gap-4">
      <section className="rounded-lg border bg-white p-4" aria-label="Run status">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{runStatusLabel(run.status)}</Badge>
          <p className="text-sm font-medium">{position}</p>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {run.snapshot.name} · started {new Date(run.createdAt).toLocaleString()}
        </p>
      </section>
      {run.interaction ? (
        <OverviewActionCard interaction={run.interaction} runId={run.runId} busy={busy} onRespond={onRespond} />
      ) : null}
      {run.error ? (
        <section className="grid gap-1 rounded-lg border border-red-200 bg-red-50 p-4" aria-label="Run problem">
          <h2 className="font-semibold text-red-900">Something went wrong</h2>
          <p role="alert" className="whitespace-pre-wrap text-sm text-red-700">
            {run.error}
          </p>
        </section>
      ) : null}
      <section className="rounded-lg border bg-white p-4" aria-label="Run progress">
        <h2 className="font-semibold">Steps</h2>
        {run.snapshot.activities.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No steps yet.</p>
        ) : (
          <ol className="mt-2 grid gap-2">
            {run.snapshot.activities.map((activity, index) => {
              const state = stepStateFor(run, activity.activityId);
              return (
                <li key={activity.activityId} className="flex items-center gap-3 rounded-md border p-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{activity.name}</span>
                    <span className="block text-xs text-slate-500">
                      Step {index + 1} of {run.snapshot.activities.length} · {stepStateLabel(state)}
                    </span>
                  </span>
                  <Badge variant={state === "done" ? "success" : state === "needs-you" || state === "failed" ? "warning" : "secondary"}>
                    {stepStateLabel(state)}
                  </Badge>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {run.publication ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="font-medium">Pull request published</p>
          <a
            className="text-sm underline"
            href={/^https?:\/\//.test(run.publication.url) ? run.publication.url : undefined}
            target="_blank"
            rel="noreferrer"
          >
            {run.publication.url}
          </a>
          {run.acceptedFindings ? (
            <p className="mt-1 text-sm">Unresolved findings were accepted and disclosed.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RunDetails({
  run,
  busy,
  notifications,
  onRespond,
}: {
  run: WorkflowRun;
  busy: boolean;
  notifications: RunNotification[];
  onRespond: (response: HumanResponse) => Promise<void>;
}) {
  return (
    <div className="grid gap-5">
      {run.interaction ? (
        <HumanInteractionPanel
          key={run.interaction.interactionId}
          interaction={run.interaction}
          runId={run.runId}
          diff={run.workspaceResult?.diff}
          busy={busy}
          onRespond={onRespond}
        />
      ) : null}
      {run.publication ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="font-medium">Pull request published</p>
          <a
            className="text-sm underline"
            href={/^https?:\/\//.test(run.publication.url) ? run.publication.url : undefined}
            target="_blank"
            rel="noreferrer"
          >
            {run.publication.url}
          </a>
          {run.acceptedFindings ? (
            <p className="mt-1 text-sm">Unresolved findings were accepted and disclosed.</p>
          ) : null}
        </div>
      ) : null}
      <section className="grid gap-2 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">Workflow graph</h2>
        <WorkflowGraph
          definition={run.snapshot}
          statusByActivityId={statusByActivityId(run)}
          currentActivityId={currentActivityId(run)}
        />
      </section>
      <section className="grid gap-2 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">Run workspace</h2>
        {run.workspaceResult ? (
          <>
            <dl className="grid gap-1 text-sm">
              <div>
                <dt className="inline text-slate-500">Retained worktree: </dt>
                <dd className="inline break-all font-mono">{run.workspaceResult.worktreePath}</dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Branch: </dt>
                <dd className="inline font-mono">{run.workspaceResult.branch}</dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Pinned commit: </dt>
                <dd className="inline font-mono">{run.workspaceResult.pinnedCommit}</dd>
              </div>
            </dl>
            {run.workspaceResult.setupLog !== undefined ? (
              <details>
                <summary className="cursor-pointer text-sm">Setup logs</summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-slate-50 p-3 text-xs">
                  {run.workspaceResult.setupLog}
                </pre>
              </details>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-slate-500">
            Preparing a separate worktree from {run.workspace.branch ?? "the project's current branch"}.
          </p>
        )}
        <p className="text-xs text-slate-500">
          Original uncommitted edits remain in the project checkout. Worktrees and documents are retained after
          completion or cancellation.
        </p>
      </section>
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Activity executions</h2>
        {run.executions.length === 0 ? (
          <p className="text-sm text-slate-500">Waiting for the coordinator to dispatch the first activity.</p>
        ) : null}
        {run.executions.map((execution, index) => (
          <details
            key={execution.executionId}
            open={index === run.executions.length - 1}
            className="rounded-lg border bg-white"
          >
            <summary className="cursor-pointer p-4 font-medium">
              {index + 1}. {execution.activity.name}{" "}
              <span className="text-sm font-normal text-slate-500">
                · {execution.status}
                {execution.outcome ? ` · ${execution.outcome}` : ""}
              </span>
            </summary>
            <div className="grid gap-3 border-t p-4">
              <dl className="grid gap-1 text-xs text-slate-500">
                <div>
                  <dt className="inline">Execution: </dt>
                  <dd className="inline font-mono">{execution.executionId}</dd>
                </div>
                <div>
                  <dt className="inline">Session: </dt>
                  <dd className="inline font-mono">{execution.sessionId ?? "Not started"}</dd>
                </div>
                <div>
                  <dt className="inline">Harness turns: </dt>
                  <dd className="inline">
                    {execution.harnessTurnIds.length} · dispatch {execution.dispatchSequence} · recovery attempt{" "}
                    {execution.recoveryAttempt}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Resolved settings: </dt>
                  <dd className="inline">
                    {`${execution.activity.execution.harness} · ${execution.activity.execution.model} · ${execution.activity.execution.effort}`}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Bound input revisions: </dt>
                  <dd className="inline font-mono">{execution.inputRevisionIds.join(", ") || "None"}</dd>
                </div>
                <div>
                  <dt className="inline">Output revisions: </dt>
                  <dd className="inline font-mono">{execution.outputRevisionIds.join(", ") || "None"}</dd>
                </div>
              </dl>
              {execution.error ? (
                <p role="alert" className="whitespace-pre-wrap rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {execution.error}
                </p>
              ) : null}
              {execution.transcript.map((entry) => (
                <article
                  key={entry.entryId}
                  className={`rounded-md p-3 ${entry.role === "user" ? "bg-blue-50" : "bg-slate-50"}`}
                >
                  <p className="mb-2 text-xs font-medium capitalize text-slate-500">
                    {entry.role} · {new Date(entry.createdAt).toLocaleString()}
                  </p>
                  <ReadOnlyMarkdown content={entry.content} />
                </article>
              ))}
            </div>
          </details>
        ))}
      </section>
      <RunDocuments documents={run.documents} approvedRevisionIds={run.interaction?.outputRevisionIds} />
      <RunNotifications notifications={notifications} />
      <details className="rounded-lg border bg-white p-4">
        <summary className="cursor-pointer font-medium">Frozen workflow definition</summary>
        <p className="my-2 text-xs text-slate-500">
          Definition and resolved activity settings captured when this run started.
        </p>
        <ol className="grid gap-2">
          {run.snapshot.activities.map((activity) => (
            <li key={activity.activityId} className="rounded-md border p-3">
              <h3 className="text-sm font-medium">{activity.name}</h3>
              <p className="mb-2 text-xs text-slate-500">
                {`${activity.execution.harness} · ${activity.execution.model} · ${activity.execution.effort}`} · Human
                input: {activity.humanInput}
              </p>
              <ReadOnlyMarkdown content={activity.instructions} />
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

export function WorkflowRunView({
  run,
  projectId,
  projectName,
  busy,
  deleting,
  notifications,
  onRespond,
  onDelete,
}: {
  run: WorkflowRun;
  projectId: string;
  projectName: string;
  busy: boolean;
  deleting: boolean;
  notifications: RunNotification[];
  onRespond: (response: HumanResponse) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [tab, setTab] = useState("overview");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const active = isRunActive(run);
  const canDelete = !active;
  return (
    <div className="grid gap-5">
      <RunBreadcrumbs projectId={projectId} projectName={projectName} runName={run.name} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{run.name}</h1>
          <p className="text-sm text-slate-500">
            {run.snapshot.name} · started {new Date(run.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{runStatusLabel(run.status)}</Badge>
          {active ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmingCancel(true)}>
              Cancel run
            </Button>
          ) : null}
          <span className="inline-flex flex-col items-end gap-1">
            <Button size="sm" variant="destructive" disabled={!canDelete || deleting} onClick={() => setConfirmingDelete(true)}>
              {deleting ? "Deleting…" : "Delete run"}
            </Button>
            {!canDelete ? (
              <span className="text-xs text-slate-500">Cancel the run before deleting it.</span>
            ) : null}
          </span>
        </div>
      </header>
      {confirmingCancel ? (
        <div role="dialog" aria-label="Cancel run" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-semibold">Stop this run now?</p>
          <p className="mt-1 text-sm text-slate-600">The run will stop where it is. You can delete it afterwards.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmingCancel(false)}>
              Keep running
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setConfirmingCancel(false);
                void onRespond({ runId: run.runId, messageId: crypto.randomUUID(), action: "cancel" });
              }}
            >
              Cancel run
            </Button>
          </div>
        </div>
      ) : null}
      {confirmingDelete ? (
        <div role="dialog" aria-label="Delete run" className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="font-semibold">Delete this run?</p>
          <p className="mt-1 text-sm text-red-800">This removes the run and its history. This cannot be undone.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" disabled={deleting} onClick={() => setConfirmingDelete(false)}>
              Keep run
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                setConfirmingDelete(false);
                void onDelete();
              }}
            >
              {deleting ? "Deleting…" : "Delete run"}
            </Button>
          </div>
        </div>
      ) : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <RunOverview run={run} busy={busy} onRespond={onRespond} />
        </TabsContent>
        <TabsContent value="details">
          <RunDetails run={run} busy={busy} notifications={notifications} onRespond={onRespond} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function WorkflowRunDetail({
  projectId,
  runId,
  runs,
  workspace,
}: {
  projectId: string;
  runId: string;
  runs: WorkflowRunPort;
  workspace: ProjectWorkspacePort;
}) {
  const navigate = useNavigate();
  const { notify } = useToast();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [notifications, setNotifications] = useState<RunNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [projectName, setProjectName] = useState(projectId);
  const submitting = useRef(false);
  useEffect(() => {
    let active = true;
    void workspace
      .listProjects()
      .then((projects) => {
        if (!active) return;
        const found = projects.find((candidate) => candidate.projectId === projectId);
        setProjectName(found?.name ?? projectId);
      })
      .catch(() => {
        if (active) setProjectName(projectId);
      });
    return () => {
      active = false;
    };
  }, [projectId, workspace]);
  useEffect(() => {
    let active = true;
    let loading = false;
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const next = await runs.getRun(runId);
        if (active) setRun(next);
        const messages = await runs.listNotifications(runId);
        if (active) setNotifications(messages);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "Could not load run.");
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [runId, runs]);
  async function respond(response: HumanResponse) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await runs.submitCommand(response);
      setRun(await runs.getRun(runId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not submit response.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await runs.deleteRun(runId);
      notify("Run deleted", "The run and its history were removed.");
      await navigate({ to: "/projects/$projectId", params: { projectId } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not delete run.");
      setDeleting(false);
    }
  }
  return (
    <div className="grid gap-3">
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {run ? (
        run.projectId !== projectId ? (
          <div className="grid gap-2">
            <h1 className="text-xl font-semibold">Run not found in this project</h1>
            <p className="text-sm text-slate-500">This run belongs to another project.</p>
            <Link
              to="/projects/$projectId"
              params={{ projectId }}
              className="text-sm font-semibold text-[#45659a] hover:text-[#18243a]"
            >
              Back to project runs
            </Link>
          </div>
        ) : (
          <WorkflowRunView
            run={run}
            projectId={projectId}
            projectName={projectName}
            busy={busy}
            deleting={deleting}
            notifications={notifications}
            onRespond={respond}
            onDelete={remove}
          />
        )
      ) : (
        <p role="status">Loading workflow run…</p>
      )}
    </div>
  );
}
