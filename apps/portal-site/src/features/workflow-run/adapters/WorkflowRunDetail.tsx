import { useEffect, useRef, useState } from "react";
import type { HumanResponse, WorkflowRun } from "@factory/workflow";
import type {
  RunNotification,
  WorkflowRunPort,
} from "../domain/WorkflowRunPort";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
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
export function WorkflowRunView({
  run,
  busy,
  onRespond,
}: {
  run: WorkflowRun;
  busy: boolean;
  onRespond: (response: HumanResponse) => Promise<void>;
}) {
  const isTerminal = ["completed", "cancelled", "failed"].includes(run.status);
  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{run.name}</h1>
          <p className="text-sm text-slate-500">
            {run.snapshot.name} · started{" "}
            {new Date(run.createdAt).toLocaleString()}
          </p>
        </div>
        <Badge>{run.status}</Badge>
      </header>
      {run.error ? (
        <p
          role="alert"
          className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {run.error}
        </p>
      ) : null}
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
      {!run.interaction && !isTerminal ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void onRespond({
                runId: run.runId,
                messageId: crypto.randomUUID(),
                action: "cancel",
              })
            }
          >
            Cancel run
          </Button>
        </div>
      ) : null}
      {run.publication ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="font-medium">Pull request published</p>
          <a
            className="text-sm underline"
            href={
              /^https?:\/\//.test(run.publication.url)
                ? run.publication.url
                : undefined
            }
            target="_blank"
            rel="noreferrer"
          >
            {run.publication.url}
          </a>
          {run.acceptedFindings ? (
            <p className="mt-1 text-sm">
              Unresolved findings were accepted and disclosed.
            </p>
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
                <dd className="inline break-all font-mono">
                  {run.workspaceResult.worktreePath}
                </dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Branch: </dt>
                <dd className="inline font-mono">
                  {run.workspaceResult.branch}
                </dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Pinned commit: </dt>
                <dd className="inline font-mono">
                  {run.workspaceResult.pinnedCommit}
                </dd>
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
            Preparing a separate worktree from{" "}
            {run.workspace.branch ?? "the project's current branch"}.
          </p>
        )}
        <p className="text-xs text-slate-500">
          Original uncommitted edits remain in the project checkout. Worktrees
          and documents are retained after completion or cancellation.
        </p>
      </section>
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Activity executions</h2>
        {run.executions.length === 0 ? (
          <p className="text-sm text-slate-500">
            Waiting for the coordinator to dispatch the first activity.
          </p>
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
                  <dd className="inline font-mono">
                    {execution.sessionId ?? "Not started"}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Harness turns: </dt>
                  <dd className="inline">
                    {execution.harnessTurnIds.length} · dispatch{" "}
                    {execution.dispatchSequence} · recovery attempt{" "}
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
                  <dd className="inline font-mono">
                    {execution.inputRevisionIds.join(", ") || "None"}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Output revisions: </dt>
                  <dd className="inline font-mono">
                    {execution.outputRevisionIds.join(", ") || "None"}
                  </dd>
                </div>
              </dl>
              {execution.error ? (
                <p
                  role="alert"
                  className="whitespace-pre-wrap rounded-md bg-red-50 p-3 text-sm text-red-700"
                >
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
      <RunDocuments
        documents={run.documents}
        approvedRevisionIds={run.interaction?.outputRevisionIds}
      />
      <details className="rounded-lg border bg-white p-4">
        <summary className="cursor-pointer font-medium">
          Frozen workflow definition
        </summary>
        <p className="my-2 text-xs text-slate-500">
          Definition and resolved activity settings captured when this run
          started.
        </p>
        <ol className="grid gap-2">
          {run.snapshot.activities.map((activity) => (
            <li key={activity.activityId} className="rounded-md border p-3">
              <h3 className="text-sm font-medium">{activity.name}</h3>
              <p className="mb-2 text-xs text-slate-500">
                {`${activity.execution.harness} · ${activity.execution.model} · ${activity.execution.effort}`}{" "}
                · Human input: {activity.humanInput}
              </p>
              <ReadOnlyMarkdown content={activity.instructions} />
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

export function WorkflowRunDetail({
  runId,
  runs,
}: {
  runId: string;
  runs: WorkflowRunPort;
}) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [notifications, setNotifications] = useState<RunNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
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
        if (active)
          setError(
            failure instanceof Error ? failure.message : "Could not load run.",
          );
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
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not submit response.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3">
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
      {run ? (
        <>
          <WorkflowRunView run={run} busy={busy} onRespond={respond} />
          <RunNotifications notifications={notifications} />
        </>
      ) : (
        <p role="status">Loading workflow run…</p>
      )}
    </div>
  );
}
