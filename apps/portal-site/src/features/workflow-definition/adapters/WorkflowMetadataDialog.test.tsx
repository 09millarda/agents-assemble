import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { WorkflowMetadataDialog } from "./WorkflowMetadataDialog";

test("workflow metadata stays readonly until the pencil action is used", () => {
  const html = renderToString(
    <WorkflowMetadataDialog
      metadata={{ name: "Build feature", description: "A feature workflow", tags: ["delivery"] }}
      onSave={() => {}}
    />,
  );

  expect(html).toContain("Build feature");
  expect(html).toContain("A feature workflow");
  expect(html).toContain("delivery");
  expect(html).toContain('aria-label="Edit workflow metadata"');
  expect(html).not.toContain('placeholder="What is this workflow for?"');
});
