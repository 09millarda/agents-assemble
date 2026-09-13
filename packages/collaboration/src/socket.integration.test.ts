import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { z } from "zod";
import { createApplication } from "../../../apps/api/src/app.ts";
import { testDatabaseUrl as databaseUrl } from "../../../scripts/test-database.ts";
import { attachCollaborationServer } from "./socket.ts";

const frameSchema = z.object({
  type: z.string(),
  operationId: z.string().optional(),
  cursor: z.number().optional(),
  draft: z
    .object({
      data: z.object({
        stateBase64: z.string(),
        content: z.string(),
        epoch: z.string(),
        sequence: z.number(),
      }),
    })
    .optional(),
});
type Frame = z.infer<typeof frameSchema>;
type Client = { socket: WebSocket; frames: Frame[]; doc: Y.Doc; token: string };
let application: Awaited<ReturnType<typeof createApplication>>;
let server: Server;
let channel: ReturnType<typeof attachCollaborationServer>;
let organizationId: string;
let ownerToken: string;
let url: string;
const clients: Client[] = [];
async function api(path: string, body?: unknown, token = ownerToken) {
  const response = await application.router.app.request(`http://local/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Organization-Id": organizationId,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  expect(response.status, JSON.stringify(value)).toBe(200);
  return value;
}
function waitFor(
  client: Client,
  predicate: (frame: Frame) => boolean,
  timeout = 10000,
): Promise<Frame> {
  const existing = client.frames.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      reject(new Error("Expected collaboration frame did not arrive"));
    }, timeout);
    const poll = setInterval(() => {
      const found = client.frames.find(predicate);
      if (found) {
        clearTimeout(deadline);
        clearInterval(poll);
        resolve(found);
      }
    }, 10);
  });
}
async function connect(token: string, documentId: string, cursor = 0) {
  const socket = new WebSocket(url);
  const client: Client = { socket, frames: [], doc: new Y.Doc(), token };
  clients.push(client);
  socket.on("message", (bytes) => {
    const frame = frameSchema.parse(JSON.parse(bytes.toString()));
    client.frames.push(frame);
    if (frame.draft) Y.applyUpdate(client.doc, Buffer.from(frame.draft.data.stateBase64, "base64"));
  });
  await once(socket, "open");
  socket.send(
    JSON.stringify({
      protocol: "aa-collaboration/1",
      type: "join",
      token,
      organizationId,
      owner: "knowledge",
      documentId,
      cursor,
    }),
  );
  await waitFor(client, (frame) => frame.type === "sync");
  return client;
}
beforeAll(async () => {
  application = await createApplication({
    databaseUrl,
    sessionKey: "collaboration-acceptance-key-at-least32",
    deploymentId: "collaboration",
  });
  const email = `collab-owner-${randomUUID()}@example.test`;
  const owner = await application.access.bootstrap({
    email,
    name: "Owner",
    password: "collaboration-password-long",
    organizationName: "Collaboration test",
  });
  organizationId = owner.organizationId;
  ownerToken = (await api("/auth/login", { email, password: "collaboration-password-long" })).token;
  server = serve({ fetch: application.router.app.fetch, port: 0, hostname: "127.0.0.1" }) as Server;
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener address");
  url = `ws://127.0.0.1:${address.port}/api/v1/collaboration/socket`;
  channel = attachCollaborationServer(server, application.access, {
    catalog: application.catalogCollaboration,
    knowledge: application.knowledge,
  });
});
afterAll(async () => {
  for (const client of clients) client.socket.terminate();
  await channel?.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await application?.close();
});
it("converges five authenticated Yjs clients with attributed durable receipts on a 50 KiB Markdown document", async () => {
  const tokens = [ownerToken];
  for (let index = 0; index < 4; index++) {
    const email = `collab-member-${randomUUID()}@example.test`;
    const invitation = await api("/invitations", { email, role: "member" });
    await api("/auth/accept-invitation", {
      token: invitation.token,
      name: `Editor ${index}`,
      password: "collaboration-password-long",
    });
    tokens.push(
      (await api("/auth/login", { email, password: "collaboration-password-long" })).token,
    );
  }
  const draft = await api("/knowledge/documents", {
    title: "Five collaborators",
    content: "x".repeat(50 * 1024),
  });
  const replicas = await Promise.all(tokens.map((token) => connect(token, draft.id)));
  const startedAt = performance.now();
  await Promise.all(
    replicas.map(async (client, index) => {
      const vector = Y.encodeStateVector(client.doc);
      client.doc
        .getText("markdown")
        .insert(client.doc.getText("markdown").length, ` editor-${index}`);
      const operationId = randomUUID();
      client.socket.send(
        JSON.stringify({
          protocol: "aa-collaboration/1",
          type: "update",
          operationId,
          epoch: draft.data.epoch,
          updateBase64: Buffer.from(Y.encodeStateAsUpdate(client.doc, vector)).toString("base64"),
        }),
      );
      await waitFor(
        client,
        (frame) => frame.type === "receipt" && frame.operationId === operationId,
      );
    }),
  );
  await Promise.all(
    replicas.map((client) =>
      waitFor(client, (frame) => frame.type === "sync" && frame.cursor === 5),
    ),
  );
  expect(performance.now() - startedAt).toBeLessThan(10000);
  const texts = replicas.map((client) => client.doc.getText("markdown").toString());
  expect(new Set(texts).size).toBe(1);
  for (let index = 0; index < 5; index++) expect(texts[0]).toContain(`editor-${index}`);
  const history = await api(`/collaboration/knowledge/${draft.id}/updates?cursor=0`);
  expect(history.items).toHaveLength(5);
  expect(
    new Set(history.items.map((item: { data: { actorId: string } }) => item.data.actorId)).size,
  ).toBe(5);
  for (const client of replicas) client.socket.close();
});
it("recovers acknowledged content and queued original update identity after a real 60-second disconnect", async () => {
  const draft = await api("/knowledge/documents", { title: "Reconnect", content: "start" });
  const client = await connect(ownerToken, draft.id);
  client.socket.close();
  await once(client.socket, "close");
  const vector = Y.encodeStateVector(client.doc);
  client.doc.getText("markdown").insert(5, " offline");
  const updateBase64 = Buffer.from(Y.encodeStateAsUpdate(client.doc, vector)).toString("base64");
  const operationId = randomUUID();
  await api(`/collaboration/knowledge/${draft.id}/replace`, {
    epoch: draft.data.epoch,
    expectedSequence: 0,
    content: "server changed",
  });
  await new Promise((resolve) => setTimeout(resolve, 60000));
  const startedAt = performance.now();
  const reconnect = await connect(ownerToken, draft.id);
  reconnect.socket.send(
    JSON.stringify({
      protocol: "aa-collaboration/1",
      type: "update",
      operationId,
      epoch: draft.data.epoch,
      updateBase64,
    }),
  );
  await waitFor(
    reconnect,
    (frame) => frame.type === "receipt" && frame.operationId === operationId,
  );
  await waitFor(reconnect, (frame) => frame.type === "sync" && frame.cursor === 2);
  expect(performance.now() - startedAt).toBeLessThan(10000);
  const state = await api(`/collaboration/knowledge/${draft.id}`);
  expect(state.data.content).toContain("offline");
  expect(state.data.content).toContain("server changed");
  const response = await application.router.app.request(
    `http://local/api/v1/collaboration/knowledge/${draft.id}/updates`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "X-Organization-Id": organizationId,
        "Content-Type": "application/json",
        "Idempotency-Key": operationId,
      },
      body: JSON.stringify({ epoch: draft.data.epoch, updateBase64 }),
    },
  );
  expect(response.status).toBe(200);
  expect((await response.json()).data.sequence).toBe(2);
}, 75000);
