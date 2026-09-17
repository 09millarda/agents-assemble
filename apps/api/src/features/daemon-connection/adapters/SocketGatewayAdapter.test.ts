import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { attachSocketGateway } from "./SocketGatewayAdapter";
import { DaemonSocketRegistry } from "../infrastructure/daemonSocketRegistry";
import type { DaemonRegistryPort } from "../domain/DaemonConnectionPort";
import type { WorkflowDaemonFact } from "@factory/workflow";
import { EphemeralDaemonLogBroker } from "../infrastructure/EphemeralDaemonLogBroker";
import type { DaemonDetails } from "@factory/shared-domain";

const runtimeFacts = {
  machineName: "workstation",
  operatingSystem: "linux",
  architecture: "x64",
  cpuCount: 8,
  memoryBytes: 16_000_000_000,
  daemonVersion: "0.0.0",
  harnessVersions: [],
  capabilities: [],
  lastSeenAt: "2026-09-17T12:00:00.000Z",
};

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
      JSON.stringify({
        type: "daemon.hello",
        daemonId: "owned-daemon",
        machineName: "workstation",
        runtimeFacts,
      }),
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
    socket.send(
      JSON.stringify({
        type: "workflow.fact",
        fact: {
          factId: "fact-2",
          commandId: "command-1",
          executionId: "execution-1",
          runId: "run-1",
          type: "completed",
          sessionId: "session-1",
          harnessTurnId: "turn-1",
          completion: { outcome: "done" },
          workspaceResult: {
            worktreePath: "/tmp/run-worktree",
            branch: "codex/workflow-run-1",
            pinnedCommit: "commit-1",
          },
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(facts).toContainEqual({
      daemonId: "owned-daemon",
      fact: {
        factId: "fact-2",
        commandId: "command-1",
        executionId: "execution-1",
        runId: "run-1",
        type: "completed",
        sessionId: "session-1",
        harnessTurnId: "turn-1",
        completion: { outcome: "done" },
        workspaceResult: {
          worktreePath: "/tmp/run-worktree",
          branch: "codex/workflow-run-1",
          pinnedCommit: "commit-1",
        },
      },
    });
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

test("daemon socket applies pending configuration and accepts acknowledgements, telemetry, runtime facts, and raw logs", async () => {
  const server = createServer();
  const broker = new EphemeralDaemonLogBroker();
  const sockets = new DaemonSocketRegistry(broker);
  const applied: number[] = [];
  const rejected: Array<{ revision: number; reason: string }> = [];
  const recordedFacts: unknown[] = [];
  const logs: unknown[] = [];
  broker.subscribe("owned-daemon", (event) => {
    logs.push(event);
  });
  const details: DaemonDetails = {
    daemonId: "owned-daemon",
    machineName: "workstation",
    status: "online",
    configuration: {
      desired: {
        displayName: "Builder",
        maxParallelHarnesses: 3,
        location: "Studio",
        deviceLabel: "tower",
        purpose: "Build",
        ownerTeam: "Platform",
        tags: ["fast"],
        notes: "",
      },
      applied: null,
      revision: 7,
      appliedRevision: null,
      status: "pending",
      failureReason: null,
    },
    runtimeFacts: null,
    telemetry: null,
  };
  const registry: DaemonRegistryPort = {
    issueDaemonCredentials: async () => { throw new Error("unused"); },
    updateDaemonOnHello: async () => {},
    listKnownDaemons: async () => [],
    listDaemons: async () => [],
    verifyDaemonToken: async (id, token) => id === "owned-daemon" && token === "secret",
    deregisterDaemon: async () => "not-found",
  };
  const control = {
    findDaemon: async () => details,
    recordRuntimeFacts: async (_daemonId: string, facts: unknown) => {
      recordedFacts.push(facts);
      return details;
    },
    recordAppliedConfiguration: async (_daemonId: string, revision: number) => {
      applied.push(revision);
      return details;
    },
    recordRejectedConfiguration: async (_daemonId: string, revision: number, reason: string) => {
      rejected.push({ revision, reason });
      return details;
    },
  };
  attachSocketGateway(server, registry, sockets, undefined, control);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/daemon`, {
    headers: { authorization: "Bearer secret" },
  });
  const messages: unknown[] = [];
  socket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  try {
    await new Promise<void>((resolve) => socket.once("open", resolve));
    const helloPayload = JSON.stringify({
      type: "daemon.hello",
      daemonId: "owned-daemon",
      machineName: "workstation",
      runtimeFacts,
    });
    socket.send(helloPayload);
    await new Promise((resolve) => setTimeout(resolve, 20));
    socket.send(JSON.stringify({ type: "daemon.configuration.applied", revision: 7 }));
    socket.send(JSON.stringify({ type: "daemon.configuration.rejected", revision: 8, reason: "unsupported" }));
    socket.send(JSON.stringify({
      type: "daemon.telemetry",
      telemetry: { activeHarnesses: 2, queuedCommands: 1, desiredMaxParallelHarnesses: 3, appliedMaxParallelHarnesses: 3 },
    }));
    socket.send(JSON.stringify({ type: "daemon.log", source: "harness-stderr", payload: "exact secret" }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(messages).toContainEqual({ type: "daemon.welcome", daemonId: "owned-daemon" });
    expect(messages).toContainEqual({
      type: "daemon.configuration",
      revision: 7,
      configuration: details.configuration.desired,
    });
    expect(recordedFacts).toHaveLength(1);
    expect(applied).toEqual([7]);
    expect(rejected).toEqual([{ revision: 8, reason: "unsupported" }]);
    expect(sockets.getDaemonTelemetry("owned-daemon")).toEqual({
      activeHarnesses: 2,
      queuedCommands: 1,
      desiredMaxParallelHarnesses: 3,
      appliedMaxParallelHarnesses: 3,
    });
    const capturedPayloads = logs.flatMap((event) => {
      if (
        typeof event === "object" &&
        event !== null &&
        "log" in event &&
        typeof event.log === "object" &&
        event.log !== null &&
        "payload" in event.log
      ) return [event.log.payload];
      return [];
    });
    expect(capturedPayloads).toContain(helloPayload);
    expect(capturedPayloads).toContain("exact secret");
  } finally {
    socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
