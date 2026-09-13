import { Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Details, ErrorNotice, Status } from "@/components/workspace";
import { asRecord, type Credentials, type RecordData, resource, text } from "@/lib/api";

const syncFrame = z.object({
  protocol: z.literal("aa-collaboration/1"),
  type: z.literal("sync"),
  draft: z.record(z.string(), z.unknown()),
  updates: z.array(z.record(z.string(), z.unknown())),
  cursor: z.number().int(),
});
const receiptFrame = z.object({
  protocol: z.literal("aa-collaboration/1"),
  type: z.literal("receipt"),
  operationId: z.string(),
  receipt: z.record(z.string(), z.unknown()),
});
const presenceFrame = z.object({
  protocol: z.literal("aa-collaboration/1"),
  type: z.literal("presence"),
  actorId: z.string(),
  cursor: z.number(),
  expiresAt: z.number(),
});
function encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function decode(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
/** Acknowledged updates survive reconnect; unacknowledged frames retain their exact operation identity. */
export function LiveMarkdown({
  id,
  credentials,
  onSaved,
  onPending,
}: {
  id: string;
  credentials: Credentials;
  onSaved: () => void;
  onPending: (pending: boolean) => void;
}) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("connecting");
  const [cursor, setCursor] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<Error>();
  const [history, setHistory] = useState<RecordData[]>([]);
  const [presence, setPresence] = useState<Record<string, number>>({});
  const [initialDocument] = useState(() => new Y.Doc());
  const doc = useRef(initialDocument);
  const epoch = useRef("");
  const ownerCursor = useRef(0);
  const socket = useRef<WebSocket | undefined>(undefined);
  const pending = useRef(new Map<string, RecordData>());
  const ready = useRef(false);
  const notifySaved = useRef(onSaved);
  notifySaved.current = onSaved;
  useEffect(() => onPending(pendingCount > 0), [pendingCount, onPending]);
  useEffect(() => {
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (disposed) return;
      setStatus("connecting");
      ready.current = false;
      const connection = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/collaboration/socket`,
      );
      socket.current = connection;
      connection.onopen = () => {
        connection.send(
          JSON.stringify({
            protocol: "aa-collaboration/1",
            type: "join",
            token: credentials.token,
            organizationId: credentials.organizationId,
            owner: "knowledge",
            documentId: id,
            cursor: ownerCursor.current,
          }),
        );
      };
      connection.onmessage = (event) => {
        try {
          const value: unknown = JSON.parse(String(event.data));
          const frame = asRecord(value);
          if (frame.type === "sync") {
            const accepted = syncFrame.parse(value);
            const draft = resource(accepted.draft);
            if (epoch.current && epoch.current !== draft.epoch) {
              if (pending.current.size) {
                setError(
                  new Error(
                    "The draft epoch changed while local updates were unacknowledged. Export your local Markdown before rejoining the current draft.",
                  ),
                );
                setStatus("conflict");
                ready.current = false;
                connection.close(1000);
                return;
              }
              doc.current.destroy();
              doc.current = new Y.Doc();
            }
            epoch.current = text(draft.epoch);
            Y.applyUpdate(doc.current, decode(text(draft.stateBase64)), "owner");
            setContent(doc.current.getText("markdown").toString());
            ownerCursor.current = accepted.cursor;
            setCursor(accepted.cursor);
            setStatus("connected");
            ready.current = true;
            setError(undefined);
            setHistory((current) => {
              const merged = new Map(current.map((item) => [text(item.id), item]));
              for (const item of accepted.updates) {
                const row = resource(item);
                merged.set(text(row.id), row);
              }
              return [...merged.values()];
            });
            for (const frame of pending.current.values()) connection.send(JSON.stringify(frame));
          } else if (frame.type === "receipt") {
            const accepted = receiptFrame.parse(value);
            pending.current.delete(accepted.operationId);
            setPendingCount(pending.current.size);
            notifySaved.current();
          } else if (frame.type === "presence") {
            const accepted = presenceFrame.parse(value);
            setPresence((current) => ({ ...current, [accepted.actorId]: accepted.expiresAt }));
          } else if (frame.type === "presence_left")
            setPresence((current) =>
              Object.fromEntries(
                Object.entries(current).filter(([actor]) => actor !== frame.actorId),
              ),
            );
          else if (frame.type === "error") {
            setError(
              new Error(text(frame.message) || "The collaboration owner rejected this update."),
            );
            setStatus("blocked");
            ready.current = false;
          }
        } catch {
          setError(
            new Error(
              "The collaboration service sent an unsupported frame. Local updates remain unconfirmed.",
            ),
          );
          setStatus("blocked");
          ready.current = false;
        }
      };
      connection.onclose = (event) => {
        ready.current = false;
        if (disposed) return;
        setStatus(event.code === 1008 ? "authorization_required" : "disconnected");
        if (event.code !== 1008 && event.code !== 1000) reconnect = setTimeout(connect, 1500);
      };
      connection.onerror = () => setStatus("disconnected");
    };
    connect();
    const expire = setInterval(
      () =>
        setPresence((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([, expiresAt]) => expiresAt > Date.now()),
          ),
        ),
      5000,
    );
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      clearInterval(expire);
      socket.current?.close(1000);
    };
  }, [credentials.token, credentials.organizationId, id]);
  const edit = (value: string, position: number) => {
    const shared = doc.current.getText("markdown");
    const before = shared.toString();
    let start = 0;
    while (start < before.length && start < value.length && before[start] === value[start]) start++;
    let end = 0;
    while (
      end < before.length - start &&
      end < value.length - start &&
      before[before.length - 1 - end] === value[value.length - 1 - end]
    )
      end++;
    const vector = Y.encodeStateVector(doc.current);
    doc.current.transact(() => {
      shared.delete(start, before.length - start - end);
      shared.insert(start, value.slice(start, value.length - end));
    }, "editor");
    const operationId = crypto.randomUUID();
    const frame = {
      protocol: "aa-collaboration/1",
      type: "update",
      operationId,
      epoch: epoch.current,
      updateBase64: encode(Y.encodeStateAsUpdate(doc.current, vector)),
    };
    pending.current.set(operationId, frame);
    setPendingCount(pending.current.size);
    setContent(shared.toString());
    if (ready.current && socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(frame));
      socket.current.send(
        JSON.stringify({ protocol: "aa-collaboration/1", type: "presence", cursor: position }),
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
            ? `${pendingCount} updates awaiting durable acknowledgment`
            : `Saved through owner cursor ${cursor}`}
        </span>
        <span>{Object.keys(presence).length} collaborator presence signals</span>
      </div>
      <ErrorNotice error={error} />
      <label htmlFor={`live-markdown-${id}`} className="sr-only">
        Collaborative Markdown
      </label>
      <Textarea
        id={`live-markdown-${id}`}
        value={content}
        disabled={
          !epoch.current ||
          status === "blocked" ||
          status === "conflict" ||
          status === "authorization_required"
        }
        onChange={(event) => edit(event.target.value, event.target.selectionStart)}
        onSelect={(event) => {
          if (socket.current?.readyState === WebSocket.OPEN && ready.current)
            socket.current.send(
              JSON.stringify({
                protocol: "aa-collaboration/1",
                type: "presence",
                cursor: event.currentTarget.selectionStart,
              }),
            );
        }}
        className="min-h-[460px] bg-white font-mono text-xs leading-6"
        spellCheck={false}
      />
      <Details value={history} title="Acknowledged edits and actor attribution" />
      <Button
        variant="outline"
        onClick={() => {
          const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = `planning-${id}.md`;
          link.click();
          URL.revokeObjectURL(url);
        }}
      >
        Export local Markdown
      </Button>
      <p className="text-xs leading-5 text-slate-500">
        Presence is ephemeral. Only owner receipts confirm a saved edit. Reconnection reuses
        operation identities for unacknowledged updates.
      </p>
    </div>
  );
}
