import { describe, expect, mock, test } from "bun:test";
import type { WorkflowConnectionHandler } from "./WebSocketDaemonConnectionAdapter";
class FakeDaemonSocket {
  static instances: FakeDaemonSocket[] = [];
  static sent: string[] = [];
  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  constructor() {
    FakeDaemonSocket.instances.push(this);
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  once(event: string, handler: (...args: unknown[]) => void): void {
    const wrapper = (...args: unknown[]) => {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter((candidate) => candidate !== wrapper));
      handler(...args);
    };
    this.on(event, wrapper);
  }

  send(payload: string): void {
    FakeDaemonSocket.sent.push(payload);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args);
  }

  static reset(): void {
    FakeDaemonSocket.instances = [];
    FakeDaemonSocket.sent = [];
  }
}

mock.module("ws", () => ({ WebSocket: FakeDaemonSocket }));

const { WebSocketDaemonConnectionAdapter } = await import("./WebSocketDaemonConnectionAdapter");

async function connectDaemon(workflow: WorkflowConnectionHandler) {
  FakeDaemonSocket.reset();
  const connection = new WebSocketDaemonConnectionAdapter("daemon-1", "workstation", workflow);
  const connected = connection.connectToFactoryApi("http://factory", "token-1");
  const socket = FakeDaemonSocket.instances[0]!;
  socket.emit("open");
  const hello = JSON.parse(FakeDaemonSocket.sent[0]!);
  expect(hello.type).toBe("daemon.hello");
  expect(hello.daemonId).toBe("daemon-1");
  expect(hello.machineName).toBe("workstation");
  expect(hello.runtimeFacts.capabilities).toEqual(workflow.capabilities);
  expect(hello.runtimeFacts.harnessVersions).toEqual(
    workflow.capabilities.map(({ harness, version }) => ({ harness, version })),
  );
  FakeDaemonSocket.sent.length = 0;
  socket.emit("message", JSON.stringify({ type: "daemon.welcome", daemonId: "daemon-1" }));
  await connected;
  FakeDaemonSocket.sent.length = 0;
  return socket;
}

function sentFrames(): unknown[] {
  return FakeDaemonSocket.sent.map((payload) => JSON.parse(payload));
}

describe("WebSocketDaemonConnectionAdapter", () => {
  test("legacy chat prompts are ignored without invoking workflow execution", async () => {
    let commandsHandled = 0;
    const socket = await connectDaemon({
      capabilities: [],
      applyConfiguration: async () => ({ applied: true }),
      getTelemetry: () => ({ activeHarnesses: 0, queuedCommands: 0, desiredMaxParallelHarnesses: 1, appliedMaxParallelHarnesses: 1 }),
      setTelemetryPublisher: () => {},
      setLogPublisher: () => {},
      handleCommand: async () => {
        commandsHandled += 1;
      },
    });
    socket.emit("message", JSON.stringify({ type: "chat.prompt", daemonId: "daemon-1", requestId: "req-1", harness: "codex", model: "legacy-model", prompt: "Build it." }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(commandsHandled).toBe(0);
    expect(sentFrames()).toEqual([]);
  });
});

test("the authenticated workflow gateway preserves command identities, worktree and immutable document bindings", async () => {
  FakeDaemonSocket.reset();
  const received: unknown[] = [];
  const capabilities = [{ harness: "codex" as const, version: "0.154.0", models: [{ model: "gpt-5.4", efforts: ["high"] }], questions: true, permissions: true, structuredOutput: true }];
  const connection = new WebSocketDaemonConnectionAdapter("daemon-1", "workstation", {
    capabilities,
    applyConfiguration: async () => ({ applied: true }),
    getTelemetry: () => ({ activeHarnesses: 0, queuedCommands: 0, desiredMaxParallelHarnesses: 1, appliedMaxParallelHarnesses: 1 }),
    setTelemetryPublisher: () => {},
    setLogPublisher: () => {},
    handleCommand: async (command, emit) => {
      received.push(command);
      await emit({ factId: "command-1:0", commandId: command.commandId, executionId: command.executionId, runId: command.runId, type: "received" });
    },
  }, () => {});
  const connected = connection.connectToFactoryApi("http://factory", "token-1");
  const socket = FakeDaemonSocket.instances[0]!;
  socket.emit("open");
  expect(sentFrames()[0]).toMatchObject({
    type: "daemon.hello",
    daemonId: "daemon-1",
    machineName: "workstation",
    runtimeFacts: { capabilities },
  });
  socket.emit("message", JSON.stringify({ type: "daemon.welcome" })); await connected;
  const command = { commandId: "command-1", executionId: "execution-1", runId: "run-1", daemonId: "daemon-1", kind: "execute", activity: { activityId: "implement" }, workspace: { projectPath: "/project", pinnedCommit: "commit-1" }, workspaceResult: { worktreePath: "/runs/run-1/worktree" }, documents: [{ documentId: "criteria", revisionId: "revision-1", content: "# Criteria" }], documentContracts: [], kickoffPrompt: null };
  socket.emit("message", JSON.stringify({ type: "workflow.command", command }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(received).toEqual([command]);
  expect(sentFrames()).toContainEqual({ type: "workflow.fact", daemonId: "daemon-1", fact: { factId: "command-1:0", commandId: "command-1", executionId: "execution-1", runId: "run-1", type: "received" } });
});

test("applies complete configuration and publishes acknowledgements, telemetry, and exact local logs", async () => {
  let publishTelemetry: ((telemetry: { activeHarnesses: number; queuedCommands: number; desiredMaxParallelHarnesses: number; appliedMaxParallelHarnesses: number }) => void) | undefined;
  let publishLog: ((source: "daemon-stdout" | "daemon-stderr" | "harness-stdout" | "harness-stderr", payload: string) => void) | undefined;
  const applied: unknown[] = [];
  const socket = await connectDaemon({
    capabilities: [],
    applyConfiguration: async (configuration) => {
      applied.push(configuration);
      return { applied: true };
    },
    getTelemetry: () => ({ activeHarnesses: 0, queuedCommands: 0, desiredMaxParallelHarnesses: 1, appliedMaxParallelHarnesses: 1 }),
    setTelemetryPublisher: (publisher) => { publishTelemetry = publisher; },
    setLogPublisher: (publisher) => { publishLog = publisher; },
    handleCommand: async () => {},
  });
  const configuration = {
    displayName: "Studio builder",
    maxParallelHarnesses: 4,
    location: "London",
    deviceLabel: "tower",
    purpose: "Build workflows",
    ownerTeam: "Platform",
    tags: ["fast"],
    notes: "Exact metadata",
  };

  socket.emit("message", JSON.stringify({ type: "daemon.configuration", revision: 9, configuration }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  socket.emit("message", JSON.stringify({ type: "daemon.configuration", revision: 8, configuration }));
  publishTelemetry?.({ activeHarnesses: 2, queuedCommands: 3, desiredMaxParallelHarnesses: 4, appliedMaxParallelHarnesses: 4 });
  publishLog?.("harness-stderr", "token=exact");

  expect(applied).toEqual([configuration]);
  expect(sentFrames()).toContainEqual({ type: "daemon.configuration.applied", revision: 9 });
  expect(sentFrames()).toContainEqual({
    type: "daemon.configuration.rejected",
    revision: 8,
    reason: "Configuration revision 8 is stale.",
  });
  expect(sentFrames()).toContainEqual({
    type: "daemon.telemetry",
    telemetry: { activeHarnesses: 2, queuedCommands: 3, desiredMaxParallelHarnesses: 4, appliedMaxParallelHarnesses: 4 },
  });
  expect(sentFrames()).toContainEqual({
    type: "daemon.log",
    source: "harness-stderr",
    payload: "token=exact",
  });
});
