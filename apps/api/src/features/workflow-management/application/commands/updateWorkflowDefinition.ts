import type { WorkflowDefinition } from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowCatalogPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
import { getWorkflowDefinition } from "../queries/getWorkflowDefinition";
import { saveWorkflowDefinition } from "./saveWorkflowDefinition";
export async function updateWorkflowDefinition(
  store: WorkflowCatalogPort,
  workflowId: string,
  resource: WorkflowDefinition,
): Promise<Result<WorkflowDefinition, WorkflowError>> {
  if (resource.workflowId !== workflowId)
    return {
      ok: false,
      error: {
        code: "IDENTITY_MISMATCH",
        message: "Resource identity cannot change.",
      },
    };
  const existing = await getWorkflowDefinition(store, workflowId);
  return existing.ok ? await saveWorkflowDefinition(store, resource) : existing;
}
