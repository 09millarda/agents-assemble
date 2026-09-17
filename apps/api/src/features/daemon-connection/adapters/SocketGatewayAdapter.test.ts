import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { attachSocketGateway } from "./SocketGatewayAdapter";
import { DaemonSocketRegistry } from "../infrastructure/daemonSocketRegistry";
import type { DaemonRegistryPort } from "../domain/DaemonConnectionPort";
import type { WorkflowDaemonFact } from "@factory/workflow";

test("actual socket gateway binds execution facts to authenticated daemon and preserves command workspace", async () => {
  const server = createServer();
  const sockets = new DaemonSocketRegistry();
  const facts: { daemonId: string; fact: WorkflowDaemonFact }[] = [];
  const registry: DaemonRegistryPort = {
    issueDaemonCredentials: async () => {
      throw new Error("unused");
    },
    updateDaemonOnHello: async () => {},
    listKnownDaemons: async () => [],
    listDaemons: async () => [],
    verifyDaemonToken: async (id, token) =>
      id === "owned-daemon" && token === "secret",
    deregisterDaemon: async () => "not-found",
  };
  attachSocketGateway(server, registry, sockets, {
    connectDaemon: async () => {},
    acceptFact: async (daemonId, fact) => {
      facts.push({ daemonId, fact });
      return true;
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/daemon`, {
    headers: { authorization: "Bearer secret" },
  });
  try {
    await new Promise<void>((resolve) => socket.once("open", resolve));
    const welcome = new Promise((resolve) => socket.once("message", resolve));
    socket.send(
      JSON.stringify({ type: "daemon.hello", daemonId: "owned-daemon" }),
    );
    await welcome;
    const command = {
      type: "workflow.command",
      command: {
        commandId: "command-1",
        executionId: "execution-1",
        runId: "run-1",
        workspaceResult: { worktreePath: "/tmp/run-worktree" },
        documents: [{ revisionId: "revision-1" }],
      },
    };
    const delivered = new Promise<string>((resolve) =>
      socket.once("message", (raw) => resolve(String(raw))),
    );
    sockets.sendToDaemon("owned-daemon", JSON.stringify(command));
    expect(JSON.parse(await delivered)).toEqual(command);
    socket.send(
      JSON.stringify({
        type: "workflow.fact",
        daemonId: "forged-daemon",
        fact: {
          factId: "fact-1",
          commandId: "command-1",
          executionId: "execution-1",
          runId: "run-1",
          type: "received",
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(facts).toEqual([
      {
        daemonId: "owned-daemon",
        fact: {
          factId: "fact-1",
          commandId: "command-1",
          executionId: "execution-1",
          runId: "run-1",
          type: "received",
        },
      },
    ]);
  } finally {
    socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("legacy portal socket path is unavailable", async () => {
  const server = createServer();
  const registry: DaemonRegistryPort = {
    issueDaemonCredentials: async () => {
      throw new Error("unused");
    },
    updateDaemonOnHello: async () => {},
    listKnownDaemons: async () => [],
    listDaemons: async () => [],
    verifyDaemonToken: async () => false,
    deregisterDaemon: async () => "not-found",
  };
  attachSocketGateway(server, registry, new DaemonSocketRegistry());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/portal?daemonId=daemon-1`);
  const closeCode = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));
  try {
    expect(await closeCode).toBe(4404);
  } finally {
    socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
