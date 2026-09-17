import { useEffect, useMemo, useState } from "react";
import type {
  DaemonConfiguration,
  DaemonDetails,
  DaemonLogEnvelope,
} from "@factory/shared-domain";
import { isDaemonReachable } from "@factory/shared-domain";
import { AlertTriangle, Cpu, Radio, RefreshCw, Save } from "lucide-react";
import type { DaemonDetailsPort } from "../domain/DaemonDetailsPort";
import {
  LiveLogStreamController,
  type LiveLogStreamState,
} from "../application/LiveLogStreamController";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";

export function describeCapacityGuidance(capacity: number): string {
  if (capacity <= 2) return "A modest machine is usually sufficient for one or two active harnesses.";
  if (capacity <= 5) return "Consider at least 4 CPU cores and 8 GB of available RAM for this capacity.";
  return "Consider at least 8 CPU cores and 16 GB of available RAM. Ten concurrent harnesses can be demanding.";
}

interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

function openBrowserEventSource(url: string): EventSourceLike {
  return new EventSource(url);
}

export function DaemonDetail({
  initialDetails,
  registry,
  createEventSource = openBrowserEventSource,
  initialTab = "overview",
}: {
  initialDetails: DaemonDetails;
  registry: DaemonDetailsPort;
  createEventSource?: (url: string) => EventSourceLike;
  initialTab?: "overview" | "configuration" | "logs";
}) {
  const [details, setDetails] = useState(initialDetails);
  const [draft, setDraft] = useState(initialDetails.configuration.desired);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logs, setLogs] = useState<DaemonLogEnvelope[]>([]);
  const [droppedCount, setDroppedCount] = useState(0);
  const [logState, setLogState] = useState<LiveLogStreamState>({
    status: "locked",
    secondsRemaining: null,
  });
  const canViewLiveLogs = isDaemonReachable(details.status);
  const selectedTab = canViewLiveLogs ? activeTab : "overview";
  const logController = useMemo(() => new LiveLogStreamController({
    openStream: () => {
      const source = createEventSource(registry.buildDaemonLogStreamUrl(details.daemonId));
      source.addEventListener("daemon.log", (event) => {
        setLogs((current) => [...current, JSON.parse(event.data) as DaemonLogEnvelope]);
      });
      source.addEventListener("daemon.logs.dropped", (event) => {
        const report = JSON.parse(event.data) as { droppedCount: number };
        setDroppedCount((current) => current + report.droppedCount);
      });
      return source;
    },
    onStateChange: setLogState,
  }), [createEventSource, details.daemonId, registry]);

  useEffect(() => () => logController.dispose(), [logController]);
  useEffect(() => {
    const refresh = () => {
      void registry.getDaemon(details.daemonId).then(setDetails, () => {
        /* Keep the most recent detail snapshot during a transient poll failure. */
      });
    };
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [details.daemonId, registry]);
  useEffect(() => {
    logController.setActive(activeTab === "logs" && canViewLiveLogs);
  }, [activeTab, canViewLiveLogs, logController]);
  useEffect(() => {
    if (selectedTab !== "logs") return;
    const recordInteraction = () => logController.recordMeaningfulInteraction();
    window.addEventListener("pointerdown", recordInteraction);
    window.addEventListener("keydown", recordInteraction);
    window.addEventListener("scroll", recordInteraction, true);
    return () => {
      window.removeEventListener("pointerdown", recordInteraction);
      window.removeEventListener("keydown", recordInteraction);
      window.removeEventListener("scroll", recordInteraction, true);
    };
  }, [selectedTab, logController]);

  async function refreshDaemonDetails(): Promise<void> {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const refreshedDetails = await registry.getDaemon(details.daemonId);
      setDetails(refreshedDetails);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Failed to refresh daemon details.");
    } finally {
      setIsRefreshing(false);
    }
  }

  function updateDraft<Key extends keyof DaemonConfiguration>(
    key: Key,
    value: DaemonConfiguration[Key],
  ): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveConfiguration(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    try {
      const saved = await registry.saveDaemonConfiguration(details.daemonId, draft);
      setDetails(saved);
      setDraft(saved.configuration.desired);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save daemon configuration.");
    } finally {
      setIsSaving(false);
    }
  }

  const configuration = details.configuration;
  const telemetry = details.telemetry;

  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="portal-eyebrow">Daemons / {details.daemonId}</p>
          <h1 className="portal-display mt-2 text-3xl font-bold text-[#18243a]">{configuration.desired.displayName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Reported machine name: <span className="font-mono">{details.machineName}</span></p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void refreshDaemonDetails()} disabled={isRefreshing}>
          <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
          <span className="sr-only">{isRefreshing ? "Refreshing daemon" : "Refresh daemon"}</span>
          <span className="hidden sm:inline">{isRefreshing ? "Refreshing…" : "Refresh"}</span>
        </Button>
      </div>
      {refreshError ? <p role="alert" className="-mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{refreshError}</p> : null}

      <Tabs
        value={selectedTab}
        onValueChange={(value) => setActiveTab(value as typeof activeTab)}
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          {canViewLiveLogs ? <TabsTrigger value="logs">Live Logs</TabsTrigger> : null}
        </TabsList>
        {!canViewLiveLogs ? <p role="status" className="mt-2 text-sm text-muted-foreground">Live logs are only available while this daemon is online.</p> : null}

        <TabsContent value="overview" className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Live workload</CardTitle><CardDescription>Best-effort telemetry from the current connection.</CardDescription></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-2xl font-bold">{telemetry?.activeHarnesses ?? 0} active</p></div>
              <div><p className="text-2xl font-bold">{telemetry?.queuedCommands ?? 0} queued</p></div>
              <div><p className="font-semibold">{configuration.desired.maxParallelHarnesses}</p><p className="text-muted-foreground">Desired capacity</p></div>
              <div><p className="font-semibold">{telemetry?.appliedMaxParallelHarnesses ?? configuration.applied?.maxParallelHarnesses ?? "—"}</p><p className="text-muted-foreground">Applied capacity</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Machine identity</CardTitle><CardDescription>Facts reported by the CLI, separate from user-managed metadata.</CardDescription></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Status:</span> <Badge>{details.status}</Badge></p>
              <p><span className="text-muted-foreground">OS:</span> {details.runtimeFacts?.operatingSystem ?? "Not reported"} {details.runtimeFacts?.architecture ?? ""}</p>
              <p><span className="text-muted-foreground">CPU:</span> {details.runtimeFacts?.cpuCount ?? "Not reported"}</p>
              <p><span className="text-muted-foreground">Memory:</span> {details.runtimeFacts ? `${Math.round(details.runtimeFacts.memoryBytes / 1_000_000_000)} GB` : "Not reported"}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="configuration">
          <Card>
            <CardHeader>
              <CardTitle>Desired daemon configuration</CardTitle>
              <CardDescription>Saved by the Factory API and applied by the daemon on this connection or its next reconnect.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={configuration.status === "failed" ? "destructive" : "secondary"}>Configuration {configuration.status}</Badge>
                <span className="text-xs text-muted-foreground">Desired revision {configuration.revision}; applied revision {configuration.appliedRevision ?? "none"}</span>
              </div>
              {configuration.failureReason ? <p role="alert" className="text-sm text-red-700">{configuration.failureReason}</p> : null}
              <div className="rounded-xl border bg-[#fbfcfd] p-4 text-sm">
                <p className="font-semibold">Last applied values</p>
                {configuration.applied ? (
                  <p className="mt-1 text-muted-foreground">
                    {configuration.applied.displayName} · {configuration.applied.maxParallelHarnesses} harnesses
                    {configuration.applied.location ? ` · ${configuration.applied.location}` : ""}
                    {configuration.applied.deviceLabel ? ` · ${configuration.applied.deviceLabel}` : ""}
                  </p>
                ) : <p className="mt-1 text-muted-foreground">No configuration has been acknowledged by this daemon yet.</p>}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Display name"><Input value={draft.displayName} onChange={(event) => updateDraft("displayName", event.target.value)} /></Field>
                <Field label="Parallel agent harnesses"><Input type="number" min={1} max={10} value={draft.maxParallelHarnesses} onChange={(event) => updateDraft("maxParallelHarnesses", Number(event.target.value))} /></Field>
                <Field label="Location"><Input value={draft.location} onChange={(event) => updateDraft("location", event.target.value)} /></Field>
                <Field label="Device label"><Input value={draft.deviceLabel} onChange={(event) => updateDraft("deviceLabel", event.target.value)} /></Field>
                <Field label="Purpose"><Input value={draft.purpose} onChange={(event) => updateDraft("purpose", event.target.value)} /></Field>
                <Field label="Owner team"><Input value={draft.ownerTeam} onChange={(event) => updateDraft("ownerTeam", event.target.value)} /></Field>
                <Field label="Tags (comma-separated)"><Input value={draft.tags.join(", ")} onChange={(event) => updateDraft("tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} /></Field>
              </div>
              <Field label="Notes"><Textarea value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} /></Field>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="flex items-center gap-2 font-semibold"><Cpu className="h-4 w-4" /> Resource guidance</p>
                <p className="mt-1">{describeCapacityGuidance(draft.maxParallelHarnesses)} This is advisory; Factory does not enforce a hardware-derived limit.</p>
              </div>
              {saveError ? <p role="alert" className="text-sm text-red-700">{saveError}</p> : null}
              <Button type="button" className="w-fit" disabled={isSaving || draft.maxParallelHarnesses < 1 || draft.maxParallelHarnesses > 10 || !draft.displayName.trim()} onClick={() => void saveConfiguration()}>
                <Save className="h-4 w-4" /> {isSaving ? "Saving…" : "Save configuration"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {canViewLiveLogs ? (
          <TabsContent value="logs">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Radio className="h-4 w-4" /> Live Logs</CardTitle><CardDescription>New-only diagnostics from the daemon's current connection session.</CardDescription></CardHeader>
              <CardContent>
                {logState.status === "locked" || logState.status === "inactive" ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                    <p className="font-semibold">Exact raw diagnostics</p>
                    <p className="mt-2 text-sm leading-6">These unredacted payloads may contain sensitive workflow or machine data. Logs are not persisted, and events emitted while this stream is closed cannot be replayed.</p>
                    <Button type="button" className="mt-4" onClick={() => logController.acknowledgeAndStart()}>I understand — start streaming</Button>
                  </div>
                ) : null}
                {logState.status === "paused" ? (
                  <div className="rounded-xl border p-5">
                    <p className="font-semibold">Log streaming paused after 5 minutes of inactivity.</p>
                    <p className="mt-1 text-sm text-muted-foreground">Missed events were discarded and will not be replayed.</p>
                    <Button type="button" className="mt-4" onClick={() => logController.continueStreaming()}>Continue streaming logs</Button>
                  </div>
                ) : null}
                {droppedCount > 0 ? <p role="status" className="mb-3 text-sm text-amber-700">{droppedCount} log events were dropped because this viewer could not keep up.</p> : null}
                {(logState.status === "streaming" || logState.status === "warning") ? (
                  <div className="max-h-[32rem] overflow-auto rounded-xl bg-[#101a2e] p-4 font-mono text-xs leading-5 text-[#d8e2f1]">
                    {logs.length === 0 ? <p>Waiting for new daemon events…</p> : logs.map((log) => <p key={log.eventId}><span className="text-[#8ed4ad]">{log.occurredAt} {log.source}</span> {log.payload}</p>)}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      {logState.status === "warning" ? (
        <div role="dialog" aria-label="Log inactivity warning" className="fixed bottom-6 right-6 z-50 max-w-sm rounded-2xl border border-amber-200 bg-white p-5 shadow-xl">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" /> Log streaming will pause in {logState.secondsRemaining} seconds.</p>
          <p className="mt-2 text-sm text-muted-foreground">Interact with this page to keep streaming.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => logController.dismissWarning()}>Dismiss</Button>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium"><span>{label}</span>{children}</label>;
}
