import {
  WORKFLOW_DEFAULT_EFFORT,
  WORKFLOW_DEFAULT_MODEL,
  type Activity,
  type WorkflowDefinition,
} from "./WorkflowDefinition";
export function createFeatureBuildingWorkflow(
  model = WORKFLOW_DEFAULT_MODEL,
  effort = WORKFLOW_DEFAULT_EFFORT,
): WorkflowDefinition {
  const agent = (
    activityId: string,
    name: string,
    description: string,
    instructions: string,
    humanInput: Activity["humanInput"],
    target: string | null,
    approval = false,
    outcome = "done",
  ): Activity => ({
    activityId,
    name,
    description,
    instructions,
    execution: { kind: "agent", harness: "codex", model, effort },
    humanInput,
    outcomes: [
      {
        name: outcome,
        handoff: {
          targetActivityId: target,
          continuation: approval ? "approval" : "automatic",
        },
      },
    ],
  });
  const activities: Activity[] = [
    agent(
      "requirements",
      "Establish requirements",
      "Ask the user what to build before planning.",
      "Interview the user. Ask for missing details and restate the goal before finishing.",
      "input",
      "plan",
      true,
    ),
    agent(
      "plan",
      "Research and plan",
      "Turn the agreed goal into a small implementation plan.",
      "Read the repository instructions and propose the smallest coherent implementation.",
      "approval",
      "implement",
      true,
    ),
    agent(
      "implement",
      "Implement",
      "Build the approved plan with tests.",
      "Implement the approved plan with red-green-refactor tests. Keep changes inside the run worktree.",
      "off",
      "review",
    ),
    agent(
      "review",
      "Review",
      "Check the implementation against the plan.",
      "Review the current code and tests against the plan. Finish with the pass outcome when no blocking findings remain.",
      "approval",
      null,
      true,
      "pass",
    ),
  ];
  activities[3]!.outcomes.push({
    name: "changes_requested",
    handoff: { targetActivityId: "implement", continuation: "automatic" },
  });
  return {
    workflowId: "feature-building",
    name: "Build a feature",
    description: "Turn an agreed goal into a tested implementation through planning, building, and review.",
    status: "draft",
    tags: [],
    activities,
    positions: {
      requirements: { x: 40, y: 40 },
      plan: { x: 320, y: 40 },
      implement: { x: 600, y: 40 },
      review: { x: 600, y: 280 },
    },
  };
}
