import { isWorkflowRunTerminal } from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowError,
  WorkflowRunPort,
} from "../../domain/WorkflowStorePort";

export type DeletedWorkflowRun = { deleted: true };

function isRunDeletable(status: string): boolean {
  return isWorkflowRunTerminal(status as "completed");
}

export async function deleteWorkflowRun(
  store: Pick<WorkflowRunPort, "findRun" | "deleteRun">,
  runId: string,
): Promise<Result<DeletedWorkflowRun, WorkflowError>> {
  const existing = await store.findRun(runId);
  if (!existing) {
    return {
      ok: false,
      error: {
        code: "WORKFLOW_RUN_NOT_FOUND",
        message: "Workflow run does not exist.",
      },
    };
  }
  if (!isRunDeletable(existing.status)) {
    return {
      ok: false,
      error: {
        code: "RUN_NOT_TERMINAL",
        message: "Cancel the run before deleting it.",
      },
    };
  }
  const deleted = await store.deleteRun(runId);
  return deleted
    ? { ok: true, value: { deleted: true } }
    : {
        ok: false,
        error: {
          code: "WORKFLOW_RUN_NOT_FOUND",
          message: "Workflow run does not exist.",
        },
      };
}
