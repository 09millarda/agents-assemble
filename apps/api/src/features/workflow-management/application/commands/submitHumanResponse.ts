import type { HumanResponse } from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  WorkflowError,
  WorkflowRunPort,
} from "../../domain/WorkflowStorePort";
export async function submitHumanResponse(
  store: WorkflowRunPort,
  response: HumanResponse,
): Promise<Result<{ accepted: true; messageId: string }, WorkflowError>> {
  if (!(await store.findRun(response.runId)))
    return {
      ok: false,
      error: {
        code: "WORKFLOW_RUN_NOT_FOUND",
        message: "Workflow run does not exist.",
      },
    };
  const outcome = await store.submitMessage(
    response.runId,
    response.messageId,
    { kind: "human", response },
  );
  if (outcome === "conflict")
    return {
      ok: false,
      error: {
        code: "MESSAGE_CONFLICT",
        message: "This message identity already belongs to another command.",
      },
    };
  return { ok: true, value: { accepted: true, messageId: response.messageId } };
}
