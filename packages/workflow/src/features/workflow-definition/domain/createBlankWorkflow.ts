import type { WorkflowDefinition } from "./WorkflowDefinition";

export function createBlankWorkflow(): WorkflowDefinition {
  return {
    workflowId: "blank",
    name: "Blank workflow",
    description: "Start with an empty canvas and add the steps you need.",
    status: "draft",
    tags: [],
    activities: [],
    positions: {},
  };
}
