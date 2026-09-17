import type { DocumentRevision } from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowRunPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
export async function getContextDocument(
  store: WorkflowRunPort,
  revisionId: string,
): Promise<Result<DocumentRevision, WorkflowError>> {
  const resource = await store.findDocument(revisionId);
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
