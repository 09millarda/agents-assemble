import type { Result } from "@factory/shared-domain";
import type {
  WorkflowCatalogPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";

export type DeletedWorkflow = { deleted: true };

export async function deleteWorkflowDefinition(
  store: Pick<WorkflowCatalogPort, "deleteDefinition">,
  workflowId: string,
): Promise<Result<DeletedWorkflow, WorkflowError>> {
  const deleted = await store.deleteDefinition(workflowId);
  return deleted
    ? { ok: true, value: { deleted: true } }
    : {
        ok: false,
        error: {
          code: "WORKFLOW_NOT_FOUND",
          message: "Workflow does not exist.",
        },
      };
}
