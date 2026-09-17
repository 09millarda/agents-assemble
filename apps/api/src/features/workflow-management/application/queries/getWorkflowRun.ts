import type { WorkflowRun } from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowRunPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
export async function getWorkflowRun(
  store: WorkflowRunPort,
  runId: string,
): Promise<Result<WorkflowRun, WorkflowError>> {
  const resource = await store.findRun(runId);
  return resource
    ? { ok: true, value: resource }
    : {
        ok: false,
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "The requested resource does not exist.",
        },
      };
}
