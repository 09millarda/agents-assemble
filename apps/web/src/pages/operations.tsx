import { Activity, ArrowUpRight, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CommandForm,
  Details,
  Empty,
  ErrorNotice,
  itemList,
  Loading,
  PageHeading,
  Status,
} from "@/components/workspace";
import { asRecord, type Credentials, text, useResource } from "@/lib/api";

export function Operations({
  credentials,
  organizationName,
}: {
  credentials: Credentials;
  organizationName: string;
}) {
  const state = useResource("/operations", credentials);
  const health = useResource("/health");
  const [selected, setSelected] = useState("");
  const messages = useResource(selected ? `/operations/${selected}/messages` : null, credentials);
  useEffect(() => {
    const interval = window.setInterval(() => {
      state.refresh();
      health.refresh();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [state.refresh, health.refresh]);
  return (
    <>
      <PageHeading
        eyebrow={organizationName}
        title="Operations"
        description="Inspect worker liveness, durable delivery lag, poison messages, and service health."
        action={
          <Button
            variant="outline"
            onClick={() => {
              state.refresh();
              health.refresh();
            }}
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />
      <ErrorNotice error={state.error ?? health.error} />
      {state.loading && !state.data && <Loading />}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Activity className="size-4 text-slate-400" />
        <span className="text-sm text-slate-600">Control plane</span>
        {health.data && <Status value={health.data.status} />}
        <span className="text-xs text-slate-500">
          Database: {text(health.data?.database) || "unconfirmed"}
        </span>
      </div>
      <p className="mb-5 text-xs leading-5 text-slate-500">
        Worker observations refresh every 5 seconds. A completed cycle becomes stale after 30
        seconds. API availability and worker activity are reported separately.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {itemList(state.data, "contexts").map((context) => {
          const worker = asRecord(context.worker ?? {});
          const workerStatus = text(worker.status) || "unknown";
          return (
            <Card key={text(context.context)} className="gap-4 shadow-none">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-sm capitalize">{text(context.context)}</CardTitle>
                <Status
                  value={
                    Number(context.poison) > 0
                      ? "blocked"
                      : Number(context.pending) > 0
                        ? "pending"
                        : workerStatus === "recent"
                          ? "healthy"
                          : `worker_${workerStatus}`
                  }
                />
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <dt className="text-slate-400">Pending</dt>
                    <dd className="mt-2 text-xl font-medium">{text(context.pending)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Poison</dt>
                    <dd className="mt-2 text-xl font-medium">{text(context.poison)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Oldest</dt>
                    <dd className="mt-2 text-xl font-medium">
                      {Math.round(Number(context.oldest_seconds))}
                      <span className="text-xs text-slate-400">s</span>
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 border-t pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">Worker last cycle</p>
                    <Badge
                      variant="outline"
                      className={
                        workerStatus === "recent"
                          ? "border-teal-200 bg-teal-50 text-teal-800"
                          : "border-amber-200 bg-amber-50 text-amber-900"
                      }
                    >
                      {workerStatus}
                    </Badge>
                  </div>
                  <p className="mt-2 break-words text-xs text-slate-600">
                    {worker.lastSeen ? (
                      <time dateTime={text(worker.lastSeen)}>
                        {new Date(text(worker.lastSeen)).toLocaleString()}
                      </time>
                    ) : (
                      "No completed worker cycle has been observed."
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="mt-5"
                  onClick={() => setSelected(text(context.context))}
                >
                  Inspect delivery messages
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {selected && (
        <Card className="mt-6 shadow-none">
          <CardHeader>
            <CardTitle className="capitalize">{selected} delivery messages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" onClick={messages.refresh}>
              <RefreshCw />
              Refresh messages
            </Button>
            <ErrorNotice error={messages.error} />
            {itemList(messages.data).map((message) => (
              <div key={text(message.id)} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{text(message.type)}</p>
                  <Status value={message.poison ? "blocked" : "pending"} />
                </div>
                <p className="text-xs text-slate-500">
                  Sequence {text(message.sequence)} · attempts {text(message.attempts)}
                </p>
                <p className="text-sm text-amber-800">{text(message.error)}</p>
                <CommandForm
                  title="Retry original message"
                  description="Record a reasoned retry of the same immutable message. Its original identity and delivery history are preserved."
                  path={`/operations/${selected}/messages/${text(message.id)}/retry`}
                  credentials={credentials}
                  defaults={{ expectedAttempts: message.attempts }}
                  fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                  onDone={messages.refresh}
                />
              </div>
            ))}
            {!messages.loading && !messages.error && !itemList(messages.data).length && (
              <Empty title="No pending delivery messages">
                This context has no scoped messages awaiting delivery.
              </Empty>
            )}
          </CardContent>
        </Card>
      )}
      <div className="mt-8">
        <Details value={state.data} title="Recorded operational state" />
        <a
          href="/api/v1/openapi.json"
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-xs text-teal-700"
        >
          Versioned API contract
          <ArrowUpRight className="size-3.5" />
        </a>
      </div>
    </>
  );
}
