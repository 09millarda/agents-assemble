import { expect, test } from "bun:test";
import { filterWorkflowDefinitions } from "./workflowCatalog";
import type { WorkflowDefinition } from "./WorkflowDefinition";

const workflows: WorkflowDefinition[] = [
  {
    workflowId: "build",
    name: "Build a feature",
    description: "",
    status: "published",
    tags: ["delivery", "planning"],
    activities: [],
    positions: {},
  },
  {
    workflowId: "review",
    name: "Review a change",
    description: "",
    status: "draft",
    tags: ["planning"],
    activities: [],
    positions: {},
  },
];

test("catalog filters search workflow names case-insensitively and combine filters", () => {
  expect(
    filterWorkflowDefinitions(workflows, {
      search: "FEATURE",
      status: "published",
      tags: ["planning", "delivery"],
    }).map((workflow) => workflow.workflowId),
  ).toEqual(["build"]);
});

test("catalog tag filters require every selected tag", () => {
  expect(
    filterWorkflowDefinitions(workflows, { tags: ["planning", "delivery"] }),
  ).toEqual([workflows[0]]);
});
