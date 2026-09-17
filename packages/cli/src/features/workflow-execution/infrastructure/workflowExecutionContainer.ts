import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { HarnessCapability, WorkflowDaemonFact } from "@factory/workflow";
import type { WorkflowConnectionHandler } from "../../daemon-connection/adapters/WebSocketDaemonConnectionAdapter";
import { executeWorkflowCommand } from "../application/executeWorkflowCommand";
import { CodexAppServerAdapter } from "../adapters/CodexAppServerAdapter";
import { FileExecutionJournalAdapter } from "../adapters/FileExecutionJournalAdapter";
import { GitRunWorkspaceAdapter } from "../adapters/GitRunWorkspaceAdapter";
import { GitHubCliPublicationAdapter } from "../adapters/GitHubCliPublicationAdapter";
import { runLocalProcess } from "../adapters/runLocalProcess";
import { acquireDaemonProcessLock } from "./acquireDaemonProcessLock";
import { HarnessCapacityController } from "../application/HarnessCapacityController";
import { StdioAppServerTransport } from "../adapters/StdioAppServerTransport";
import { isDaemonHarnessCapacityValid } from "@factory/shared-domain";

const runtimes = new Map<string, Promise<WorkflowConnectionHandler>>();

export function createWorkflowExecutionContainer(
  daemonId: string,
): Promise<WorkflowConnectionHandler> {
  const directory = resolve(
    process.env.FACTORY_DAEMON_STATE_DIR ??
      join(homedir(), ".factory", "workflow-execution"),
    daemonId,
  );
  const existing = runtimes.get(directory);
  if (existing) return existing;
  const runtime = initializeWorkflowExecution(directory).catch(
    (error: unknown) => {
      runtimes.delete(directory);
      throw error;
    },
  );
  runtimes.set(directory, runtime);
  return runtime;
}

async function initializeWorkflowExecution(
  directory: string,
): Promise<WorkflowConnectionHandler> {
  await acquireDaemonProcessLock(directory, (error) => {
    console.error(error.message);
    process.exit(1);
  });
  const journal = new FileExecutionJournalAdapter(join(directory, "journal"));
  const workspace = new GitRunWorkspaceAdapter(join(directory, "runs"));
  let publishLog: (
    source: "daemon-stdout" | "daemon-stderr" | "harness-stdout" | "harness-stderr",
    payload: string,
  ) => void = () => {};
  const harnessAdapter = new CodexAppServerAdapter(
    () => new StdioAppServerTransport((source, payload) => publishLog(source, payload)),
  );
  const harness = new HarnessCapacityController(harnessAdapter);
  const publisher = new GitHubCliPublicationAdapter(
    join(directory, "publication"),
    runLocalProcess,
    (workspaceResult) => workspace.inspect(workspaceResult),
  );
  let capabilities: HarnessCapability[] = [];
  try {
    capabilities = [await harness.discover()];
  } catch (error) {
    console.error(
      `Codex workflow capability unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const running = new Map<
    string,
    {
      listeners: Set<(fact: WorkflowDaemonFact) => Promise<void>>;
      promise: Promise<void>;
    }
  >();
  return {
    capabilities,
    async applyConfiguration(configuration) {
      if (!isDaemonHarnessCapacityValid(configuration.maxParallelHarnesses)) {
        return { applied: false, reason: "Harness capacity must be an integer from 1 through 10." };
      }
      harness.setCapacity(configuration.maxParallelHarnesses);
      return { applied: true };
    },
    getTelemetry: () => harness.getTelemetry(),
    setTelemetryPublisher: (publisher) => harness.setTelemetryPublisher(publisher),
    setLogPublisher: (publisher) => {
      publishLog = publisher;
    },
    async handleCommand(command, emit) {
      const active = running.get(command.commandId);
      if (active) {
        active.listeners.add(emit);
        const record = await journal.receive(
          command.commandId,
          command.executionId,
          command.runId,
        );
        for (const fact of record.facts)
          await emit(fact as unknown as WorkflowDaemonFact);
        return;
      }
      const listeners = new Set([emit]);
      const promise = executeWorkflowCommand(
        command,
        { journal, workspace, harness, publisher },
        async (fact) => {
          await Promise.all(
            [...listeners].map(async (listener) => {
              try {
                await listener(fact);
              } catch {
                /* Persisted facts will replay after reconnect. */
              }
            }),
          );
        },
      ).finally(() => {
        running.delete(command.commandId);
      });
      running.set(command.commandId, { listeners, promise });
      await promise;
    },
  };
}
