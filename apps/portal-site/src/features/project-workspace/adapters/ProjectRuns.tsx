import { Link } from "@tanstack/react-router";
import type { WorkflowRun } from "@factory/workflow";
import {
  isWorkflowRunActive,
  isWorkflowRunAwaitingAttention,
  isWorkflowRunTerminal,
} from "@factory/workflow";
import { AlertCircle, ArrowUpRight, CheckCircle2, Clock3, Inbox, PlayCircle } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";

type BadgeVariant = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";

function sortRunsByRecentUpdate(runs: WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort((firstRun, secondRun) => {
    const updatedAtOrder = secondRun.updatedAt.localeCompare(firstRun.updatedAt);
    return updatedAtOrder || secondRun.runId.localeCompare(firstRun.runId);
  });
}

function getRunStatusLabel(status: WorkflowRun["status"]): string {
  switch (status) {
    case "awaiting-human":
      return "Needs your input";
    case "recovery-required":
      return "Recovery needed";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
  }
}

function getRunStatusVariant(status: WorkflowRun["status"]): BadgeVariant {
  switch (status) {
    case "awaiting-human":
    case "recovery-required":
      return "warning";
    case "running":
    case "completed":
      return "success";
    case "failed":
      return "destructive";
    case "queued":
    case "cancelled":
      return "secondary";
  }
}

function formatRunTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function describeRunProgress(run: WorkflowRun): string {
  if (run.interaction) return run.interaction.prompt;
  const currentExecution = run.executions.at(-1);
  if (currentExecution) return `Current step: ${currentExecution.activity.name}`;
  if (run.status === "queued") return "Waiting for the coordinator to start this run.";
  return "Preparing the run workspace.";
}

function RunStatus({ status }: { status: WorkflowRun["status"] }) {
  return <Badge variant={getRunStatusVariant(status)}>{getRunStatusLabel(status)}</Badge>;
}

function RunCard({ run }: { run: WorkflowRun }) {
  return (
    <Card className="border-border/80 bg-white shadow-[0_8px_24px_rgba(31,48,78,0.05)]">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="break-words text-base">{run.name}</CardTitle>
          <CardDescription className="mt-1">{run.snapshot.name}</CardDescription>
        </div>
        <RunStatus status={run.status} />
      </CardHeader>
      <CardContent className="grid gap-4 pt-0">
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
          {describeRunProgress(run)}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Updated {formatRunTimestamp(run.updatedAt)}
          </span>
          <Link
            to="/projects/$projectId/runs/$runId"
            params={{ projectId: run.projectId, runId: run.runId }}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#45659a] hover:text-[#18243a]"
          >
            Open run <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function ActiveRunGroup({
  title,
  description,
  runs,
  icon,
}: {
  title: string;
  description: string;
  runs: WorkflowRun[];
  icon: "attention" | "progress";
}) {
  const Icon = icon === "attention" ? AlertCircle : PlayCircle;
  return (
    <section className="grid gap-3" aria-labelledby={`${icon}-runs-heading`}>
      <div className="flex items-start gap-3">
        <span
          className={
            icon === "attention"
              ? "mt-0.5 grid h-8 w-8 place-items-center rounded-xl bg-[#fff0cf] text-[#8c5412]"
              : "mt-0.5 grid h-8 w-8 place-items-center rounded-xl bg-[#e2f5eb] text-[#17603a]"
          }
        >
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 id={`${icon}-runs-heading`} className="font-semibold">
            {title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant="secondary" className="ml-auto">
          {runs.length}
        </Badge>
      </div>
      {runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-[#fbfcfd] p-5 text-sm text-muted-foreground">
          {icon === "attention"
            ? "Nothing needs your attention right now."
            : "No runs are currently in progress."}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {runs.map((run) => (
            <RunCard key={run.runId} run={run} />
          ))}
        </div>
      )}
    </section>
  );
}

function RunHistory({ runs }: { runs: WorkflowRun[] }) {
  return (
    <section className="grid gap-3" aria-labelledby="run-history-heading">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-xl bg-[#e6eefb] text-[#3b5f9e]">
          <CheckCircle2 className="h-4 w-4" />
        </span>
        <div>
          <h2 id="run-history-heading" className="text-lg font-bold">
            Run history
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Completed and stopped runs for this project.
          </p>
        </div>
        <Badge variant="secondary" className="ml-auto">
          {runs.length}
        </Badge>
      </div>
      {runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-[#fbfcfd] p-5 text-sm text-muted-foreground">
          No run history yet.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead><span className="sr-only">Open</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.runId}>
                <TableCell className="font-semibold">{run.name}</TableCell>
                <TableCell className="text-muted-foreground">{run.snapshot.name}</TableCell>
                <TableCell><RunStatus status={run.status} /></TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatRunTimestamp(run.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    to="/projects/$projectId/runs/$runId"
                    params={{ projectId: run.projectId, runId: run.runId }}
                    aria-label={`Open ${run.name}`}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#45659a] hover:text-[#18243a]"
                  >
                    Open <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export function ProjectRuns({ runs }: { runs: WorkflowRun[] }) {
  const activeRuns = sortRunsByRecentUpdate(runs.filter((run) => isWorkflowRunActive(run.status)));
  const attentionRuns = activeRuns.filter((run) => isWorkflowRunAwaitingAttention(run.status));
  const inProgressRuns = activeRuns.filter((run) => !isWorkflowRunAwaitingAttention(run.status));
  const historyRuns = sortRunsByRecentUpdate(runs.filter((run) => isWorkflowRunTerminal(run.status)));

  return (
    <div className="grid gap-7">
      <section className="grid gap-4" aria-labelledby="active-runs-heading">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl bg-[#fff3d9] text-[#aa6816]">
            <Inbox className="h-4 w-4" />
          </span>
          <div>
            <h2 id="active-runs-heading" className="text-xl font-bold tracking-tight">
              Active runs
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeRuns.length === 0
                ? "No active runs for this project."
                : `${activeRuns.length} workflow ${activeRuns.length === 1 ? "run is" : "runs are"} still active.`}
            </p>
          </div>
          <Badge variant={attentionRuns.length > 0 ? "warning" : "secondary"} className="ml-auto">
            {activeRuns.length} active
          </Badge>
        </div>
        <ActiveRunGroup
          title="Needs attention"
          description="Runs waiting for a human answer, approval, or recovery decision."
          runs={attentionRuns}
          icon="attention"
        />
        <ActiveRunGroup
          title="In progress"
          description="Runs currently queued or being worked on by a daemon."
          runs={inProgressRuns}
          icon="progress"
        />
      </section>
      <RunHistory runs={historyRuns} />
    </div>
  );
}
