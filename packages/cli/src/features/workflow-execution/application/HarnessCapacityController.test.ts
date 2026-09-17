import { describe, expect, test } from "bun:test";
import type { WorkflowDaemonCommand } from "@factory/workflow";
import type { HarnessExecutionPort } from "../domain/HarnessExecutionPort";
import { HarnessCapacityController } from "./HarnessCapacityController";

const command = (commandId: string, executionId = commandId) => ({
  commandId,
  executionId,
  runId: `run-${commandId}`,
} as WorkflowDaemonCommand);
const workspace = (name: string) => ({
  worktreePath: `/${name}`,
  branch: `factory/${name}`,
  pinnedCommit: "commit-1",
});
const capability = {
  harness: "codex" as const,
  version: "0.154.0",
  models: [],
  questions: true,
  permissions: true,
  structuredOutput: true,
};

function deferred<Result>() {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("HarnessCapacityController", () => {
  test("defaults to one active harness and admits queued work FIFO", async () => {
    const gates = [deferred<any>(), deferred<any>(), deferred<any>()];
    const started: string[] = [];
    const delegate: HarnessExecutionPort = {
      discover: async () => capability,
      execute: async (next) => {
        started.push(next.commandId);
        return gates[started.length - 1]!.promise;
      },
      cancel: async () => {},
    };
    const controller = new HarnessCapacityController(delegate);

    const first = controller.execute(command("one"), workspace("one"), "", async () => {});
    const second = controller.execute(command("two"), workspace("two"), "", async () => {});
    const third = controller.execute(command("three"), workspace("three"), "", async () => {});
    expect(started).toEqual(["one"]);
    expect(controller.getTelemetry()).toEqual({
      activeHarnesses: 1,
      queuedCommands: 2,
      desiredMaxParallelHarnesses: 1,
      appliedMaxParallelHarnesses: 1,
    });

    gates[0]!.resolve({ status: "completed", sessionId: "one", completion: { outcome: "done" } });
    await first;
    expect(started).toEqual(["one", "two"]);
    gates[1]!.resolve({ status: "completed", sessionId: "two", completion: { outcome: "done" } });
    await second;
    gates[2]!.resolve({ status: "completed", sessionId: "three", completion: { outcome: "done" } });
    await third;
  });

  test("human-waiting results release a slot and capacity reductions never pre-empt active work", async () => {
    const gates = [deferred<any>(), deferred<any>(), deferred<any>()];
    const started: string[] = [];
    const cancelled: string[] = [];
    const controller = new HarnessCapacityController({
      discover: async () => capability,
      execute: async (next) => {
        started.push(next.commandId);
        return gates[started.length - 1]!.promise;
      },
      cancel: async (executionId) => { cancelled.push(executionId); },
    });
    controller.setCapacity(2);
    const first = controller.execute(command("one"), workspace("one"), "", async () => {});
    const second = controller.execute(command("two"), workspace("two"), "", async () => {});
    const third = controller.execute(command("three"), workspace("three"), "", async () => {});
    controller.setCapacity(1);
    expect(started).toEqual(["one", "two"]);

    gates[0]!.resolve({ status: "waiting", sessionId: "one" });
    await first;
    expect(started).toEqual(["one", "two"]);
    gates[1]!.resolve({ status: "completed", sessionId: "two", completion: { outcome: "done" } });
    await second;
    expect(started).toEqual(["one", "two", "three"]);
    gates[2]!.resolve({ status: "completed", sessionId: "three", completion: { outcome: "done" } });
    await third;
    expect(cancelled).toEqual([]);
  });

  test("cancellation bypasses admission and removes matching queued execution", async () => {
    const gate = deferred<any>();
    const cancelled: string[] = [];
    const controller = new HarnessCapacityController({
      discover: async () => capability,
      execute: async () => gate.promise,
      cancel: async (executionId) => { cancelled.push(executionId); },
    });
    const active = controller.execute(command("active"), workspace("active"), "", async () => {});
    const queued = controller.execute(command("queued", "execution-queued"), workspace("queued"), "", async () => {});

    await controller.cancel("execution-queued");
    await expect(queued).rejects.toThrow("cancelled before harness admission");
    expect(cancelled).toEqual(["execution-queued"]);
    expect(controller.getTelemetry().queuedCommands).toBe(0);
    gate.resolve({ status: "completed", sessionId: "active", completion: { outcome: "done" } });
    await active;
  });
});
