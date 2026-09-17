import { createWorkflowRecoveryTransition } from "../domain/createWorkflowRecoveryTransition";
import {
  advanceWorkflowRun,
  type WorkflowMessage,
  type WorkflowRuntimePort,
} from "@factory/workflow";
import type { WorkflowMessageApplicationResult } from "../domain/WorkflowMessageApplicationResult";
export async function tryApplyWorkflowMessage(
  runId: string,
  message: WorkflowMessage,
  runtime: WorkflowRuntimePort,
  now: string,
): Promise<WorkflowMessageApplicationResult> {
  try {
    const run = await runtime.findRun(runId);
    if (!run) throw new Error(`Workflow run missing: ${runId}`);
    let transition;
    try {
      transition = advanceWorkflowRun(run, message, now);
    } catch (error) {
      transition = createWorkflowRecoveryTransition(run, message, error, now);
    }
    await runtime.saveTransition(transition);
    return { outcome: "applied", status: transition.run.status };
  } catch (error) {
    return {
      outcome: "retry",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
