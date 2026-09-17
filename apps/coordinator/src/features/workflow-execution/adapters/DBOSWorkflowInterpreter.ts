import { DBOS, WorkflowQueue } from "@dbos-inc/dbos-sdk";
import type {
  WorkflowMessage,
  WorkflowRuntimePort,
  WorkflowRun,
} from "@factory/workflow";
import { tryApplyWorkflowMessage } from "../application/tryApplyWorkflowMessage";
import { wasWorkflowMessageApplied } from "../domain/WorkflowMessageApplicationResult";
export const COORDINATOR_VERSION = "workflow-v1";
interface InterpreterOptions {
  retryDelayMs?: number;
}

export function registerWorkflowInterpreter(
  runtime: WorkflowRuntimePort,
  onDurabilityFailure: (error: unknown) => never,
  options: InterpreterOptions = {},
) {
  new WorkflowQueue("workflow-runs");
  return DBOS.registerWorkflow(
    async function interpretWorkflowRun(runId: string): Promise<void> {
      try {
        let status = await applyMessage(
          runId,
          { kind: "start", messageId: `${runId}:start` },
          runtime,
          options.retryDelayMs ?? 1000,
        );
        while (!isRunTerminal(status)) {
          const message = await DBOS.recv<WorkflowMessage>("commands", 3600);
          if (message)
            status = await applyMessage(
              runId,
              message,
              runtime,
              options.retryDelayMs ?? 1000,
            );
        }
      } catch (error) {
        // Exit before DBOS records ERROR so same-version process recovery can resume pending work.
        onDurabilityFailure(error);
      }
    },
    { name: "interpretWorkflowRun", serialization: "portable" },
  );
}
async function applyMessage(
  runId: string,
  message: WorkflowMessage,
  runtime: WorkflowRuntimePort,
  retryDelayMs: number,
): Promise<WorkflowRun["status"]> {
  for (;;) {
    const result = await DBOS.runStep(
      () =>
        tryApplyWorkflowMessage(
          runId,
          message,
          runtime,
          new Date().toISOString(),
        ),
      { name: "applyWorkflowMessage" },
    );
    if (wasWorkflowMessageApplied(result)) return result.status;
    await DBOS.sleep(retryDelayMs);
  }
}
function isRunTerminal(status: WorkflowRun["status"]): boolean {
  return ["completed", "cancelled", "failed"].includes(status);
}
