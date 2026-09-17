import type { WorkflowDefinition } from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowCatalogPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
export async function getWorkflowDefinition(
  store: WorkflowCatalogPort,
  workflowId: string,
): Promise<Result<WorkflowDefinition, WorkflowError>> {
  const resource = await store.findDefinition(workflowId);
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
