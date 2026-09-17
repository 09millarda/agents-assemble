import { expect, test } from "bun:test";
import { createBlankWorkflow } from "./createBlankWorkflow";

test("blank blueprint creates an empty editable canvas", () => {
  expect(createBlankWorkflow()).toEqual({
    workflowId: "blank",
    name: "Blank workflow",
    description: "Start with an empty canvas and add the steps you need.",
    status: "draft",
    tags: [],
    activities: [],
    positions: {},
  });
});
