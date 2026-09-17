import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ProjectInfo } from "@factory/shared-domain";
import { isDaemonReachable } from "@factory/shared-domain";
import {
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  CircleDashed,
  FolderGit2,
  MonitorCog,
  Plus,
  Radio,
  Workflow,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Skeleton } from "../components/ui/skeleton";
import { useDaemonRegistry } from "../features/daemon-connection/adapters/DaemonRegistryProvider";
import { HttpProjectWorkspaceAdapter } from "../features/project-workspace/adapters/HttpProjectWorkspaceAdapter";

function StatusDot({ online }: { online: boolean }) {
  return <span className={online ? "h-2 w-2 rounded-full bg-[#5dcc8a] shadow-[0_0_0_4px_rgba(93,204,138,0.13)]" : "h-2 w-2 rounded-full bg-[#9aa8bb]"} />;
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string | number; detail: string; icon: typeof Boxes; tone: "amber" | "blue" | "green" }) {
  const toneClasses = {
    amber: "bg-[#fff3d9] text-[#aa6816]",
    blue: "bg-[#e6eefb] text-[#3b5f9e]",
    green: "bg-[#e3f5ea] text-[#2b8152]",
  };
  return (
    <Card className="border-border/70 shadow-[0_8px_24px_rgba(31,48,78,0.04)]">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="portal-display mt-2 text-3xl font-bold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${toneClasses[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function OverviewPage() {
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

  const online = daemons.filter((daemon) => isDaemonReachable(daemon.status)).length;
  const offline = daemons.length - online;
  const healthPercentage = daemons.length === 0 ? 0 : Math.round((online / daemons.length) * 100);

  return (
    <div className="grid gap-7">
      <section className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <p className="portal-eyebrow">Operations / overview</p>
          <h1 className="portal-display mt-2 text-4xl font-bold tracking-tight text-[#18243a] md:text-5xl">Good to see you.</h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">Keep an eye on the machines that power your workflows, then jump straight into the next piece of work.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/daemons"><MonitorCog className="h-4 w-4" /> View daemons</Link>
          </Button>
          <Button asChild>
            <Link to="/projects"><Plus className="h-4 w-4" /> Open projects</Link>
          </Button>
        </div>
      </section>

      {isLoadingDaemons || isLoadingProjects ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Online daemons" value={online} detail={`${offline} offline · ${daemons.length} total`} icon={Radio} tone="green" />
          <MetricCard label="Project workspaces" value={projects.length} detail="Configured on this factory" icon={FolderGit2} tone="blue" />
          <MetricCard label="Enabled workflows" value={projects.reduce((total, project) => total + project.enabledWorkflowIds.length, 0)} detail="Across all projects" icon={Workflow} tone="amber" />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden border-0 bg-[#101a2e] text-white shadow-[0_18px_45px_rgba(16,26,46,0.18)]">
          <CardContent className="relative p-6 md:p-8">
            <div className="absolute right-0 top-0 h-56 w-56 translate-x-1/3 -translate-y-1/3 rounded-full bg-[#f6b756]/15 blur-3xl" />
            <div className="relative">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#f6b756]">Live fabric</p>
                  <h2 className="portal-display mt-2 text-2xl font-bold md:text-3xl">Connection health</h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-[#aebbd0]">Your portal talks to the Factory API, which keeps a live channel open to each machine-run daemon.</p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-[#5dcc8a]/25 bg-[#5dcc8a]/10 px-3 py-1.5 text-xs font-semibold text-[#9de2b8]">
                  <StatusDot online={true} /> Live status
                </span>
              </div>
              <div className="mt-9 grid gap-3">
                <div className="flex items-end justify-between gap-3">
                  <span className="text-sm font-semibold text-[#d6deea]">Fleet availability</span>
                  <span className="portal-display text-3xl font-bold text-[#f6b756]">{healthPercentage}%</span>
                </div>
                <Progress value={healthPercentage} className="h-2.5 bg-white/10 [&>div]:bg-[#f6b756]" />
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#91a3be]">
                  <span className="inline-flex items-center gap-2"><StatusDot online={true} /> {online} online</span>
                  <span className="inline-flex items-center gap-2"><StatusDot online={false} /> {offline} offline</span>
                  <span>{daemons.length} registered</span>
                </div>
              </div>
              <Button asChild className="mt-7 bg-[#f6b756] text-[#18243a] shadow-none hover:bg-[#ffd17f]">
                <Link to="/daemons">Manage connections <ArrowUpRight className="h-4 w-4" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Project workspaces</CardTitle>
              <CardDescription>Where your workflows are pointed.</CardDescription>
            </div>
            <Link to="/projects" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Open all projects">
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent className="pt-2">
            {projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-[#fafbfd] p-5">
                <CircleDashed className="h-5 w-5 text-muted-foreground" />
                <p className="mt-3 text-sm font-semibold">No project workspaces yet</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Create a workspace to give your workflows a home.</p>
                <Button asChild size="sm" className="mt-4"><Link to="/projects">Create a project</Link></Button>
              </div>
            ) : (
              <div className="grid gap-1">
                {projects.slice(0, 4).map((project) => (
                  <Link key={project.projectId} to="/projects/$projectId" params={{ projectId: project.projectId }} className="group flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-[#f5f8fb]">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e9f0fa] text-[#5575a7]"><FolderGit2 className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{project.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{project.absolutePath}</span>
                    </span>
                    {project.blockedReason ? <Badge variant="destructive">Blocked</Badge> : <CheckCircle2 className="h-4 w-4 shrink-0 text-[#56b97e]" />}
                  </Link>
                ))}
                {projects.length > 4 ? <p className="px-2 pt-2 text-xs text-muted-foreground">+ {projects.length - 4} more workspaces</p> : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <Link to="/workflows" className="group rounded-2xl border border-border/80 bg-white p-5 shadow-[0_8px_24px_rgba(31,48,78,0.04)] transition-all hover:-translate-y-0.5 hover:border-[#bdcbe0] hover:shadow-[0_14px_30px_rgba(31,48,78,0.08)]">
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff3d9] text-[#aa6816]"><Workflow className="h-5 w-5" /></span>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </div>
          <h2 className="mt-5 text-base font-bold">Design a workflow</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Shape the steps, outcomes, and handoffs that your daemons will execute.</p>
        </Link>
        <Link to="/activity" className="group rounded-2xl border border-border/80 bg-white p-5 shadow-[0_8px_24px_rgba(31,48,78,0.04)] transition-all hover:-translate-y-0.5 hover:border-[#bdcbe0] hover:shadow-[0_14px_30px_rgba(31,48,78,0.08)]">
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e6eefb] text-[#3b5f9e]"><Boxes className="h-5 w-5" /></span>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </div>
          <h2 className="mt-5 text-base font-bold">Review activity</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Follow workflow runs, conversations, and the health of every connected machine.</p>
        </Link>
      </section>
    </div>
  );
}

export const Route = createFileRoute("/")({ component: OverviewPage });
