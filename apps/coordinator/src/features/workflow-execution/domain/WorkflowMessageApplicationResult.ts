import type { WorkflowRun } from "@factory/workflow";
export type WorkflowMessageApplicationResult =
  | { outcome: "applied"; status: WorkflowRun["status"] }
  | { outcome: "retry"; error: string };
export function wasWorkflowMessageApplied(
  result: WorkflowMessageApplicationResult,
): result is Extract<WorkflowMessageApplicationResult, { outcome: "applied" }> {
  return result.outcome === "applied";
}
