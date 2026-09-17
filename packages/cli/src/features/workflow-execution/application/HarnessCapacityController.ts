import type { DaemonTelemetry } from "@factory/shared-domain";
import type { WorkflowDaemonCommand, WorkspaceResult } from "@factory/workflow";
import type { HarnessCapability } from "@factory/workflow";
import type {
  HarnessEvent,
  HarnessExecutionPort,
  HarnessResult,
} from "../domain/HarnessExecutionPort";

interface QueuedHarnessExecution {
  command: WorkflowDaemonCommand;
  workspace: WorkspaceResult;
  inputsPath: string;
  emit: (event: HarnessEvent) => Promise<void>;
  resolve: (result: HarnessResult) => void;
  reject: (error: Error) => void;
}

export class HarnessCapacityController implements HarnessExecutionPort {
  private capacity = 1;
  private activeHarnesses = 0;
  private readonly queue: QueuedHarnessExecution[] = [];
  private onTelemetry: (telemetry: DaemonTelemetry) => void = () => {};

  constructor(private readonly delegate: HarnessExecutionPort) {}

  discover(): Promise<HarnessCapability> {
    return this.delegate.discover();
  }

  setCapacity(capacity: number): void {
    this.capacity = capacity;
    this.publishTelemetry();
    this.admitQueuedExecutions();
  }

  setTelemetryPublisher(publisher: (telemetry: DaemonTelemetry) => void): void {
    this.onTelemetry = publisher;
    this.publishTelemetry();
  }

  getTelemetry(): DaemonTelemetry {
    return {
      activeHarnesses: this.activeHarnesses,
      queuedCommands: this.queue.length,
      desiredMaxParallelHarnesses: this.capacity,
      appliedMaxParallelHarnesses: this.capacity,
    };
  }

  execute(
    command: WorkflowDaemonCommand,
    workspace: WorkspaceResult,
    inputsPath: string,
    emit: (event: HarnessEvent) => Promise<void>,
  ): Promise<HarnessResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ command, workspace, inputsPath, emit, resolve, reject });
      this.publishTelemetry();
      this.admitQueuedExecutions();
    });
  }

  async cancel(executionId: string): Promise<void> {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const queued = this.queue[index]!;
      if (queued.command.executionId !== executionId) continue;
      this.queue.splice(index, 1);
      queued.reject(new Error("Execution cancelled before harness admission."));
    }
    this.publishTelemetry();
    await this.delegate.cancel(executionId);
  }

  private admitQueuedExecutions(): void {
    while (this.activeHarnesses < this.capacity && this.queue.length > 0) {
      const execution = this.queue.shift()!;
      this.activeHarnesses += 1;
      this.publishTelemetry();
      void this.run(execution);
    }
  }

  private async run(execution: QueuedHarnessExecution): Promise<void> {
    try {
      execution.resolve(
        await this.delegate.execute(
          execution.command,
          execution.workspace,
          execution.inputsPath,
          execution.emit,
        ),
      );
    } catch (error) {
      execution.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.activeHarnesses -= 1;
      this.publishTelemetry();
      this.admitQueuedExecutions();
    }
  }

  private publishTelemetry(): void {
    this.onTelemetry(this.getTelemetry());
  }
}
