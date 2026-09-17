import type { Result } from "@factory/shared-domain";
import type {
  WorkflowRunPort,
  WorkflowNotificationRecord,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
import { getWorkflowRun } from "./getWorkflowRun";
export async function listRunNotifications(
  store: WorkflowRunPort,
  runId: string,
): Promise<Result<WorkflowNotificationRecord[], WorkflowError>> {
  const run = await getWorkflowRun(store, runId);
  return run.ok
    ? { ok: true, value: await store.listNotifications(runId) }
    : run;
}
