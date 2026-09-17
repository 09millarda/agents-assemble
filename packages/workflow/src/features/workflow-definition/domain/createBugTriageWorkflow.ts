import {
  WORKFLOW_DEFAULT_EFFORT,
  WORKFLOW_DEFAULT_MODEL,
  type Activity,
  type WorkflowDefinition,
} from "./WorkflowDefinition";

export function createBugTriageWorkflow(
  model = WORKFLOW_DEFAULT_MODEL,
  effort = WORKFLOW_DEFAULT_EFFORT,
): WorkflowDefinition {
  const agent = (
    activityId: string,
    name: string,
    description: string,
    instructions: string,
    humanInput: Activity["humanInput"],
    outcomes: Activity["outcomes"],
  ): Activity => ({
    activityId,
    name,
    description,
    instructions,
    execution: { kind: "agent", harness: "codex", model, effort },
    humanInput,
    outcomes,
  });

  return {
    workflowId: "bug-triage",
    name: "Triage a bug",
    description: "Capture a bug report, reproduce the behavior, plan and implement a fix, then verify the result.",
    status: "draft",
    tags: [],
    activities: [
      agent(
        "intake",
        "Capture bug report",
        "Turn the report into a reproducible, scoped case.",
        "Interview the user to capture the expected behavior, actual behavior, reproduction steps, environment, and impact. Finish with report_ready when enough information is recorded.",
        "input",
        [{ name: "report_ready", handoff: { targetActivityId: "reproduce", continuation: "automatic" } }],
      ),
      agent(
        "reproduce",
        "Reproduce and isolate",
        "Confirm the behavior and narrow the failing area.",
        "Inspect the repository and tests, reproduce the reported behavior, and record the evidence. Finish with confirmed_bug, needs_information, or expected_behavior.",
        "off",
        [
          { name: "confirmed_bug", handoff: { targetActivityId: "diagnose", continuation: "automatic" } },
          { name: "needs_information", handoff: { targetActivityId: "intake", continuation: "approval" } },
          { name: "expected_behavior", handoff: { targetActivityId: null, continuation: "approval" } },
        ],
      ),
      agent(
        "diagnose",
        "Diagnose and plan fix",
        "Find the root cause and define the smallest safe fix.",
        "Trace the confirmed bug to its root cause and propose the smallest coherent fix with regression coverage. Finish with fix_ready, needs_information, or docs_or_configuration.",
        "approval",
        [
          { name: "fix_ready", handoff: { targetActivityId: "implement", continuation: "approval" } },
          { name: "needs_information", handoff: { targetActivityId: "intake", continuation: "approval" } },
          { name: "docs_or_configuration", handoff: { targetActivityId: null, continuation: "approval" } },
        ],
      ),
      agent(
        "implement",
        "Implement the fix",
        "Build the approved fix and its regression test.",
        "Implement the approved fix with a focused regression test. Run the relevant checks and finish with ready_for_review when the change is ready to inspect.",
        "off",
        [{ name: "ready_for_review", handoff: { targetActivityId: "review", continuation: "automatic" } }],
      ),
      agent(
        "review",
        "Verify the fix",
        "Review the change and confirm the original bug is resolved.",
        "Review the diff and tests, then reproduce the original bug to verify the fix. Finish with fixed when no blocking findings remain, or changes_requested when implementation work is needed.",
        "approval",
        [
          { name: "fixed", handoff: { targetActivityId: null, continuation: "approval" } },
          { name: "changes_requested", handoff: { targetActivityId: "implement", continuation: "automatic" } },
        ],
      ),
    ],
    positions: {
      intake: { x: 40, y: 40 },
      reproduce: { x: 320, y: 40 },
      diagnose: { x: 600, y: 40 },
      implement: { x: 600, y: 280 },
      review: { x: 880, y: 280 },
    },
  };
}
