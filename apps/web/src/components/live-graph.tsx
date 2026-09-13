import type { Node } from "@aa/catalog/definition";
import { Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { GraphEditor } from "@/components/graph-editor";
import { Details, ErrorNotice, Status } from "@/components/workspace";
import { asRecord, type Credentials, type RecordData, resource, text } from "@/lib/api";
import { type GraphSnapshot, graphChanges } from "./graph-changes";
import { GraphEditingContext } from "./graph-context";

const frameSchema = z
  .object({ protocol: z.literal("aa-collaboration/1"), type: z.string() })
  .passthrough();
const syncSchema = z.object({
  type: z.literal("sync"),
  cursor: z.int().nonnegative(),
  draft: z.object({
    data: z.object({
      epoch: z.uuid(),
      content: z.unknown(),
      graph: z.object({
        root: z.string(),
        entities: z.array(
          z.object({
            entityId: z.uuid(),
            deleted: z.boolean(),
            fields: z.unknown(),
            slots: z.record(z.string(), z.array(z.uuid())),
          }),
        ),
      }),
      conflicts: z.array(z.uuid()),
    }),
  }),
  updates: z.array(z.unknown()),
});
/** Exact semantic commands retain their original base and identity through disconnect/replay. */
export function LiveGraph({
  id,
  credentials,
  onSaved,
  onPending,
}: {
  id: string;
  credentials: Credentials;
  onSaved: () => void;
  onPending: (value: boolean) => void;
}) {
  const [graph, setGraph] = useState<Node>();
  const [status, setStatus] = useState("connecting");
  const [cursor, setCursor] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<Error>();
  const [history, setHistory] = useState<RecordData[]>([]);
  const [presence, setPresence] = useState<Record<string, number>>({});
  const snapshot = useRef<GraphSnapshot | undefined>(undefined),
    epoch = useRef(""),
    ownerCursor = useRef(0),
    pending = useRef(new Map<string, RecordData>()),
    socket = useRef<WebSocket | undefined>(undefined),
    ready = useRef(false),
    notify = useRef(onSaved);
  notify.current = onSaved;
  useEffect(() => onPending(pendingCount > 0), [onPending, pendingCount]);
  useEffect(() => {
    let disposed = false,
      reconnect: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (disposed) return;
      const connection = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/collaboration/socket`,
      );
      socket.current = connection;
      ready.current = false;
      setStatus("connecting");
      connection.onopen = () =>
        connection.send(
          JSON.stringify({
            protocol: "aa-collaboration/1",
            type: "join",
            token: credentials.token,
            organizationId: credentials.organizationId,
            owner: "catalog",
            documentId: id,
            cursor: ownerCursor.current,
          }),
        );
      connection.onmessage = (event) => {
        try {
          const frame = frameSchema.parse(JSON.parse(String(event.data)));
          if (frame.type === "sync") {
            const value = syncSchema.parse(frame),
              draft = value.draft.data;
            if (epoch.current && epoch.current !== draft.epoch && pending.current.size) {
              setError(
                new Error(
                  "The graph epoch changed. Pending semantic commands require explicit conflict review; they will not be replayed into a different graph.",
                ),
              );
              setStatus("conflict");
              connection.close(1000);
              return;
            }
            epoch.current = draft.epoch;
            ownerCursor.current = value.cursor;
            setCursor(value.cursor);
            snapshot.current = draft.graph as GraphSnapshot;
            const body = asRecord(draft.content).body;
            if (!body || typeof body !== "object" || !("type" in body))
              throw new Error("Owner graph cannot be represented.");
            setGraph(body as Node);
            ready.current = true;
            setStatus(draft.conflicts.length ? "conflict" : "connected");
            setHistory((current) => {
              const merged = new Map(current.map((row) => [text(row.id), row]));
              for (const item of value.updates) {
                const row = resource(item);
                merged.set(text(row.id), row);
              }
              return [...merged.values()];
            });
            for (const command of pending.current.values())
              connection.send(JSON.stringify(command));
          } else if (frame.type === "receipt") {
            const operationId = z.string().parse(frame.operationId),
              receipt = asRecord(frame.receipt);
            pending.current.delete(operationId);
            setPendingCount(pending.current.size);
            if (receipt.status === "conflict") {
              setStatus("conflict");
              setError(
                new Error(
                  "This edit overlaps a concurrent change. The owner preserved the proposal for explicit conflict review.",
                ),
              );
            } else setError(undefined);
            notify.current();
          } else if (frame.type === "presence") {
            const actor = z.string().parse(frame.actorId),
              expires = z.number().parse(frame.expiresAt);
            setPresence((current) => ({ ...current, [actor]: expires }));
          } else if (frame.type === "presence_left")
            setPresence((current) =>
              Object.fromEntries(
                Object.entries(current).filter(([actor]) => actor !== frame.actorId),
              ),
            );
          else if (frame.type === "error") {
            ready.current = false;
            setStatus("blocked");
            setError(new Error(text(frame.message) || "The owner rejected this graph command."));
          }
        } catch (failure) {
          ready.current = false;
          setStatus("blocked");
          setError(
            failure instanceof Error
              ? failure
              : new Error("Unsupported graph response; edits remain unacknowledged."),
          );
        }
      };
      connection.onclose = (event) => {
        ready.current = false;
        if (disposed) return;
        setStatus(
          event.code === 1008
            ? "authorization_required"
            : event.code === 1000
              ? "conflict"
              : "disconnected",
        );
        if (event.code !== 1008 && event.code !== 1000) reconnect = setTimeout(connect, 1000);
      };
      connection.onerror = () => setStatus("disconnected");
    };
    connect();
    const expire = setInterval(
      () =>
        setPresence((current) =>
          Object.fromEntries(Object.entries(current).filter(([, until]) => until > Date.now())),
        ),
      5000,
    );
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      clearInterval(expire);
      socket.current?.close(1000);
    };
  }, [id, credentials.token, credentials.organizationId]);
  const edit = (before: Node, after: Node) => {
    try {
      if (!snapshot.current) throw new Error("Wait for the authoritative graph before editing.");
      const command = graphChanges(snapshot.current, before, after);
      if (!command) return;
      const operationId = crypto.randomUUID(),
        frame = {
          protocol: "aa-collaboration/1",
          type: "graph",
          operationId,
          epoch: epoch.current,
          baseSequence: ownerCursor.current,
          command,
        };
      pending.current.set(operationId, frame);
      setPendingCount(pending.current.size);
      if (ready.current && socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(JSON.stringify(frame));
        socket.current.send(
          JSON.stringify({
            protocol: "aa-collaboration/1",
            type: "presence",
            cursor: ownerCursor.current,
          }),
        );
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure : new Error("This edit requires conflict review."),
      );
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {status === "connected" ? (
          <Wifi className="size-4 text-teal-700" />
        ) : (
          <WifiOff className="size-4 text-amber-700" />
        )}
        <Status value={status} />
        <span>
          {pendingCount
            ? `${pendingCount} graph edits awaiting durable acknowledgment`
            : `Graph saved through owner cursor ${cursor}`}
        </span>
        <span>{Object.keys(presence).length} collaborator presence signals</span>
      </div>
      <ErrorNotice error={error} />
      {graph && (
        <fieldset
          disabled={pendingCount > 0 || status === "blocked" || status === "authorization_required"}
        >
          <GraphEditingContext.Provider value={edit}>
            <GraphEditor node={graph} onChange={() => {}} />
          </GraphEditingContext.Provider>
        </fieldset>
      )}
      <Details value={history} title="Acknowledged graph edits and actor attribution" />
      <p className="text-xs text-slate-500">
        Edits use stable node identities and explicit ordered placements. Overlapping intent is
        preserved for review; acknowledgment confirms durability.
      </p>
    </div>
  );
}
