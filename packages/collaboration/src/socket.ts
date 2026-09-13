import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Actor } from "@aa/platform/contracts";
import type { IdentityPort } from "@aa/platform/http";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { collaborationServerFrameSchema } from "./contracts.ts";
import { graphCommandSchema } from "./graph.ts";
import type { CollaborationService } from "./service.ts";

export const collaborationFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    protocol: z.literal("aa-collaboration/1"),
    type: z.literal("join"),
    token: z.string().min(1).max(4096),
    organizationId: z.string().uuid(),
    owner: z.enum(["catalog", "knowledge"]),
    documentId: z.string().uuid(),
    cursor: z.number().int().min(0),
  }),
  z.strictObject({
    protocol: z.literal("aa-collaboration/1"),
    type: z.literal("update"),
    operationId: z.string().min(1).max(160),
    epoch: z.string().uuid(),
    updateBase64: z.string().max(700000),
  }),
  z.strictObject({
    protocol: z.literal("aa-collaboration/1"),
    type: z.literal("graph"),
    operationId: z.string().min(1).max(160),
    epoch: z.string().uuid(),
    baseSequence: z.number().int().min(0),
    command: graphCommandSchema,
  }),
  z.strictObject({
    protocol: z.literal("aa-collaboration/1"),
    type: z.literal("presence"),
    cursor: z.number().int().min(0).max(524288),
  }),
]);
type Session = {
  organizationId: string;
  owner: "catalog" | "knowledge";
  documentId: string;
  token: string;
  actor: Actor;
  cursor: number;
  version: number;
  presence?: { cursor: number; expiresAt: number };
};
/** One versioned transport over the same owner acceptance methods as HTTP. */
export function attachCollaborationServer(
  server: Server,
  identity: IdentityPort,
  owners: { catalog: CollaborationService; knowledge: CollaborationService },
  allowedOrigin?: string,
) {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });
  const sessions = new Map<WebSocket, Session>();
  const send = (socket: WebSocket, payload: unknown) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 2 * 1024 * 1024) {
      socket.close(1013, "Backpressure: reconnect from your acknowledged owner cursor");
      return;
    }
    socket.send(
      JSON.stringify(
        collaborationServerFrameSchema.parse({
          protocol: "aa-collaboration/1",
          ...(payload as object),
        }),
      ),
    );
  };
  const authorize = async (session: Session) => {
    const principal = await identity.authenticate(
      new Request("http://local/collaboration", {
        headers: { Authorization: `Bearer ${session.token}` },
      }),
    );
    session.actor = await identity.authorize(principal, session.organizationId, "member");
  };
  const refresh = async (socket: WebSocket, session: Session) => {
    await authorize(session);
    const draft = await owners[session.owner].read(session.organizationId, session.documentId);
    if (draft.version !== session.version) {
      const history = await owners[session.owner].history(
        session.organizationId,
        session.documentId,
        session.cursor,
      );
      send(socket, { type: "sync", draft, updates: history.items, cursor: draft.data.sequence });
      session.cursor = draft.data.sequence;
      session.version = draft.version;
    }
  };
  server.on("upgrade", (request, socket, head) => {
    if (request.url?.split("?")[0] !== "/api/v1/collaboration/socket") return;
    if (allowedOrigin && request.headers.origin && request.headers.origin !== allowedOrigin) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (websocket) =>
      sockets.emit("connection", websocket),
    );
  });
  sockets.on("connection", (socket) => {
    const timeout = setTimeout(() => {
      if (!sessions.has(socket)) socket.close(1008, "Authentication required");
    }, 10000);
    timeout.unref();
    let chain = Promise.resolve();
    socket.on("message", (bytes, binary) => {
      chain = chain
        .then(async () => {
          if (binary) throw new Error("Use the versioned JSON collaboration frame");
          const frame = collaborationFrameSchema.parse(JSON.parse(bytes.toString()));
          if (frame.type === "join") {
            if (sessions.has(socket)) throw new Error("A session is already joined");
            const principal = await identity.authenticate(
              new Request("http://local/collaboration", {
                headers: { Authorization: `Bearer ${frame.token}` },
              }),
            );
            const actor = await identity.authorize(principal, frame.organizationId, "member");
            const draft = await owners[frame.owner].read(frame.organizationId, frame.documentId);
            const history = await owners[frame.owner].history(
              frame.organizationId,
              frame.documentId,
              frame.cursor,
            );
            sessions.set(socket, {
              ...frame,
              actor,
              cursor: draft.data.sequence,
              version: draft.version,
            });
            clearTimeout(timeout);
            send(socket, {
              type: "sync",
              draft,
              updates: history.items,
              cursor: draft.data.sequence,
            });
            return;
          }
          const session = sessions.get(socket);
          if (!session) throw new Error("Join an authorized document first");
          await authorize(session);
          if (frame.type === "presence") {
            session.presence = { cursor: frame.cursor, expiresAt: Date.now() + 30000 };
            for (const [peer, other] of sessions)
              if (
                other.owner === session.owner &&
                other.organizationId === session.organizationId &&
                other.documentId === session.documentId
              ) {
                await authorize(other);
                send(peer, {
                  type: "presence",
                  actorId: session.actor.userId,
                  cursor: frame.cursor,
                  expiresAt: session.presence.expiresAt,
                });
              }
            return;
          }
          const meta = {
            organizationId: session.organizationId,
            actorId: session.actor.userId,
            operation: frame.type === "update" ? "draft_update" : "graph_command",
            operationId: frame.operationId,
            request: {
              id: session.documentId,
              ...(frame.type === "update"
                ? { epoch: frame.epoch, updateBase64: frame.updateBase64 }
                : { epoch: frame.epoch, baseSequence: frame.baseSequence, command: frame.command }),
            },
            correlationId: randomUUID(),
          };
          const receipt =
            frame.type === "update"
              ? await owners[session.owner].update(meta, session.documentId, frame)
              : await owners[session.owner].graph(meta, session.documentId, frame);
          send(socket, { type: "receipt", operationId: frame.operationId, receipt });
          await refresh(socket, session);
        })
        .catch((error: unknown) => {
          send(socket, {
            type: "error",
            code:
              error && typeof error === "object" && "code" in error ? error.code : "invalid_frame",
            message: error instanceof Error ? error.message.slice(0, 1000) : "Invalid frame",
          });
          if (!sessions.has(socket))
            socket.close(1008, "Authentication or document scope rejected");
        });
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      const departed = sessions.get(socket);
      sessions.delete(socket);
      if (departed)
        for (const [peer, other] of sessions)
          if (
            other.organizationId === departed.organizationId &&
            other.owner === departed.owner &&
            other.documentId === departed.documentId
          )
            send(peer, { type: "presence_left", actorId: departed.actor.userId });
    });
  });
  let refreshing = false;
  const poll = setInterval(async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      await Promise.all(
        [...sessions].map(async ([socket, session]) => {
          try {
            await refresh(socket, session);
            if (session.presence && session.presence.expiresAt <= Date.now()) {
              session.presence = undefined;
              send(socket, { type: "presence_expired" });
            }
          } catch {
            socket.close(1008, "Authorization or owner state unavailable");
          }
        }),
      );
    } finally {
      refreshing = false;
    }
  }, 500);
  poll.unref();
  return {
    close: async () => {
      clearInterval(poll);
      for (const socket of sockets.clients)
        socket.close(1001, "Server closing; reconnect from acknowledged cursor");
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
    },
  };
}
