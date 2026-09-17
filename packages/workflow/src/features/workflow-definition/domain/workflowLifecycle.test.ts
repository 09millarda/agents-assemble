import { expect, test } from "bun:test";
import {
  isWorkflowPublished,
  normalizeWorkflowTags,
  validateWorkflowTags,
} from "./workflowLifecycle";

test("workflow tags are normalized into lowercase unique labels", () => {
  expect(normalizeWorkflowTags([" Planning ", "delivery", "PLANNING", ""])).toEqual([
    "planning",
    "delivery",
  ]);
});

test("workflow tags reject more than twenty labels", () => {
  const tags = Array.from({ length: 21 }, (_, index) => `tag-${index}`);

  expect(validateWorkflowTags(tags)).toBe("A workflow can have at most 20 tags");
});

test("workflow tags reject labels longer than fifty characters", () => {
  expect(validateWorkflowTags(["a".repeat(51)])).toBe(
    "Workflow tags must be 50 characters or fewer",
  );
});

test("only Published workflows are eligible to start", () => {
  expect(isWorkflowPublished("published")).toBe(true);
  expect(isWorkflowPublished("draft")).toBe(false);
});
