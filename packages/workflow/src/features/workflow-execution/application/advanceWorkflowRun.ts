import type {
  WorkflowRun,
  WorkflowMessage,
  WorkflowTransition,
} from "../domain/WorkflowRun";
import { reduceWorkflowMessage } from "../domain/reduceWorkflowMessage";
import { createWorkflowNotifications } from "../domain/createWorkflowNotifications";
export {
  createWorkflowRun,
  type StartWorkflowInput,
} from "../domain/createWorkflowRun";

export function advanceWorkflowRun(
  previous: WorkflowRun,
  message: WorkflowMessage,
  now: string,
): WorkflowTransition {
  const transition = reduceWorkflowMessage(previous, message, now);
  transition.run.updatedAt = now;
  createWorkflowNotifications(previous, transition);
  return transition;
}
