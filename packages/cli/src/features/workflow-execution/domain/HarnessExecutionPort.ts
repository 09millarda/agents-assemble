import type {
  CompletionContract,
  HarnessCapability,
  WorkflowDaemonCommand,
  WorkspaceResult,
} from "@factory/workflow";
export interface HarnessEvent {
  harnessTurnId?: string;
  type: "progress" | "question" | "permission";
  message: string;
  sessionId: string;
  interactionId?: string;
  permissionRequest?: unknown;
}
export type HarnessResult =
  | {
      status: "completed";
      harnessTurnId?: string;
      sessionId: string;
      completion: CompletionContract;
    }
  | { status: "waiting"; harnessTurnId?: string; sessionId: string };
export interface HarnessExecutionPort {
  discover(): Promise<HarnessCapability>;
  execute(
    command: WorkflowDaemonCommand,
    workspace: WorkspaceResult,
    inputsPath: string,
    emit: (event: HarnessEvent) => Promise<void>,
  ): Promise<HarnessResult>;
  cancel(executionId: string): Promise<void>;
}
