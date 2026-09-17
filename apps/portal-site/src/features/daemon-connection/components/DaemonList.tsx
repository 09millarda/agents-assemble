import { useState } from "react";
import { Check, MonitorCog, RefreshCw, Search } from "lucide-react";
import type { DaemonSummary } from "@factory/shared-domain";
import { isDaemonReachable } from "@factory/shared-domain";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { cn } from "../../../lib/utils";
import { RemoveDaemonDialog } from "./RemoveDaemonDialog";
import { DaemonRowActions } from "./DaemonRowActions";
import { Link } from "@tanstack/react-router";

type StatusFilter = "all" | "online" | "offline";

export function DaemonList({
  daemons,
  onRefresh,
  isLoading,
  loadError,
  onDeregisterDaemon,
}: {
  daemons: DaemonSummary[];
  onRefresh: () => void;
  isLoading: boolean;
  loadError?: string | null;
  onDeregisterDaemon?: (daemonId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pendingDaemon, setPendingDaemon] = useState<DaemonSummary | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const filtered = daemons.filter((daemon) => {
    const matchesSearch =
      search.trim().length === 0 ||
      daemon.displayName.toLowerCase().includes(search.trim().toLowerCase()) ||
      daemon.machineName.toLowerCase().includes(search.trim().toLowerCase()) ||
      daemon.daemonId.toLowerCase().includes(search.trim().toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "online" ? isDaemonReachable(daemon.status) : !isDaemonReachable(daemon.status));
    return matchesSearch && matchesStatus;
  });

  async function confirmDeregisterDaemon(): Promise<void> {
    if (!pendingDaemon || !onDeregisterDaemon) return;
    setIsConfirming(true);
    setConfirmError(null);
    try {
      await onDeregisterDaemon(pendingDaemon.daemonId);
      setPendingDaemon(null);
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : "Failed to deregister daemon.");
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/70 bg-[#fbfcfd] pb-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e6eefb] text-[#3b5f9e]"><MonitorCog className="h-5 w-5" /></span>
            <div>
              <CardTitle>Daemon fleet</CardTitle>
              <CardDescription>Machine-run daemons dialled in to the Factory API.</CardDescription>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            <span className="sr-only">{isLoading ? "Refreshing daemons" : "Refresh daemons"}</span>
            <span className="hidden sm:inline">{isLoading ? "Refreshing…" : "Refresh"}</span>
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search daemons"
              placeholder="Search by machine or daemon ID…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 pl-9"
            />
          </div>
          <div className="flex gap-1" role="group" aria-label="Status filter">
            {(["all", "online", "offline"] as const).map((status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={statusFilter === status ? "secondary" : "ghost"}
                className={cn(statusFilter === status && "bg-[#e9eef5] text-[#18243a]")}
                onClick={() => setStatusFilter(status)}
              >
                {status[0].toUpperCase() + status.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loadError ? (
          <p role="alert" className="m-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {loadError}
          </p>
        ) : null}
        {pendingDaemon ? (
          <div className="m-5 mb-0">
            <RemoveDaemonDialog
              machineName={pendingDaemon.displayName}
              isConfirming={isConfirming}
              confirmError={confirmError}
              onConfirm={() => void confirmDeregisterDaemon()}
              onCancel={() => {
                if (!isConfirming) {
                  setPendingDaemon(null);
                  setConfirmError(null);
                }
              }}
            />
          </div>
        ) : null}
        {isLoading && daemons.length === 0 ? (
          <div className="grid gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="m-5 rounded-2xl border border-dashed border-border bg-[#fbfcfd] p-8 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#e9f0fa] text-[#5575a7]"><MonitorCog className="h-5 w-5" /></span>
            <p className="mt-4 text-sm font-semibold">No daemons match.</p>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              {daemons.length === 0 ? (
                <>No daemons registered yet. Run <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">cli auth login</code> on the machine, then approve it from the verification URL shown in your terminal.</>
              ) : (
                <>Try clearing the search or choosing a different status filter.</>
              )}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Machine</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Live work</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((daemon) => {
                const isOnline = isDaemonReachable(daemon.status);
                return (
                  <TableRow key={daemon.daemonId}>
                    <TableCell>
                      <Link
                        to="/daemons/$daemonId"
                        params={{ daemonId: daemon.daemonId }}
                        className="font-medium text-[#315d9b] hover:underline"
                      >
                        {daemon.displayName}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">{daemon.machineName} · <span className="font-mono">{daemon.daemonId}</span></p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={isOnline ? "success" : "secondary"}>
                        {isOnline ? <Check className="mr-1 h-3 w-3" /> : null}
                        {daemon.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {daemon.appliedMaxParallelHarnesses ?? "—"} applied / {daemon.maxParallelHarnesses} desired
                    </TableCell>
                    <TableCell>{daemon.activeHarnesses} active · {daemon.queuedCommands} queued</TableCell>
                    <TableCell className="text-right">
                      <DaemonRowActions
                        daemon={daemon}
                        canDeregister={onDeregisterDaemon !== undefined}
                        onDeregister={(target) => {
                          setPendingDaemon(target);
                          setConfirmError(null);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
