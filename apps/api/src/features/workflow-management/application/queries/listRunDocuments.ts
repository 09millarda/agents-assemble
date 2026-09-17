import type { DocumentRevision } from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowRunPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
import { getWorkflowRun } from "./getWorkflowRun";
export async function listRunDocuments(
  store: WorkflowRunPort,
  runId: string,
): Promise<Result<DocumentRevision[], WorkflowError>> {
  const run = await getWorkflowRun(store, runId);
  return run.ok ? { ok: true, value: run.value.documents } : run;
}
