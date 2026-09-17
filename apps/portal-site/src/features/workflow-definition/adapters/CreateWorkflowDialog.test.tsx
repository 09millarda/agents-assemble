import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { CreateWorkflowDialog, WorkflowCreationForm } from "./CreateWorkflowDialog";

test("create workflow dialog exposes a create trigger", () => {
  const html = renderToString(
    <CreateWorkflowDialog
      onCreate={async () => {}}
    />,
  );

  expect(html).toContain("Create workflow");
  expect(html).toContain('aria-haspopup="dialog"');
});

test("workflow creation form offers metadata fields and all workflow templates", () => {
  const html = renderToString(
    <WorkflowCreationForm onCreate={async () => {}} onCancel={() => {}} />,
  );

  for (const text of [
    "Create workflow",
    "Workflow name",
    "Workflow description",
    "Choose a template",
    "Blank",
    "Feature building",
    "Bug triage",
  ]) {
    expect(html).toContain(text);
  }
});
