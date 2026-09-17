export type HumanInputMode = "off" | "approval" | "input";
export interface Handoff {
  targetActivityId: string | null;
  continuation: "automatic" | "approval";
}
export interface ActivityOutcome {
  name: string;
  handoff: Handoff;
}
export interface ActivityExecutionSettings {
  kind: "agent";
  harness: "codex";
  model: string;
  effort: string;
}
export interface Activity {
  activityId: string;
  name: string;
  description: string;
  instructions: string;
  execution: ActivityExecutionSettings;
  humanInput: HumanInputMode;
  outcomes: ActivityOutcome[];
}
export interface WorkflowPosition {
  x: number;
  y: number;
}
export interface WorkflowDefinition {
  workflowId: string;
  name: string;
  description: string;
  activities: Activity[];
  positions: Record<string, WorkflowPosition>;
}
export interface HarnessCapability {
  harness: "codex";
  version: string;
  models: { model: string; efforts: string[] }[];
  questions: boolean;
  permissions: boolean;
  structuredOutput: boolean;
}
export const WORKFLOW_HARNESS = "codex" as const;
export const WORKFLOW_MODELS = ["gpt-5.6-sol", "gpt-5.3-codex"] as const;
export const WORKFLOW_EFFORTS = ["low", "medium", "high"] as const;
export const WORKFLOW_DEFAULT_MODEL = "gpt-5.6-sol";
export const WORKFLOW_DEFAULT_EFFORT = "medium";
export type WorkflowModel = (typeof WORKFLOW_MODELS)[number];
export type WorkflowEffort = (typeof WORKFLOW_EFFORTS)[number];
export function isSupportedModelEffort(model: string, effort: string): boolean {
  return (
    (WORKFLOW_MODELS as readonly string[]).includes(model) &&
    (WORKFLOW_EFFORTS as readonly string[]).includes(effort)
  );
}
export function findWorkflowStartActivityId(
  workflow: Pick<WorkflowDefinition, "activities">,
): string | null {
  if (!workflow.activities.length) return null;
  const targets = new Set<string>();
  for (const activity of workflow.activities)
    for (const outcome of activity.outcomes)
      if (outcome.handoff.targetActivityId)
        targets.add(outcome.handoff.targetActivityId);
  return (
    workflow.activities.find(
      (activity) => !targets.has(activity.activityId),
    )?.activityId ?? workflow.activities[0]!.activityId
  );
}
