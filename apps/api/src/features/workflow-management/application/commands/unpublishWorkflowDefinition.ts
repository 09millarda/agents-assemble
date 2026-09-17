import type { WorkflowDefinition } from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowCatalogPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";

export async function unpublishWorkflowDefinition(
  store: WorkflowCatalogPort,
  workflowId: string,
): Promise<Result<WorkflowDefinition, WorkflowError>> {
  const definition = await store.unpublishDefinition(workflowId);
  return definition
    ? { ok: true, value: definition }
    : {
        ok: false,
        error: {
          code: "WORKFLOW_NOT_FOUND",
          message: "Workflow does not exist.",
        },
      };
}
