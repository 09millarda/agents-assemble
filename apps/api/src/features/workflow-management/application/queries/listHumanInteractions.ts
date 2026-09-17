import type { HumanInteraction } from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowRunPort,
  WorkflowError,
} from "../../domain/WorkflowStorePort";
import { getWorkflowRun } from "./getWorkflowRun";
export async function listHumanInteractions(
  store: WorkflowRunPort,
  runId: string,
): Promise<Result<HumanInteraction[], WorkflowError>> {
  const run = await getWorkflowRun(store, runId);
  return run.ok
    ? { ok: true, value: run.value.interaction ? [run.value.interaction] : [] }
    : run;
}
