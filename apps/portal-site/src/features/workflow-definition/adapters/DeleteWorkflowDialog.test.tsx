import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Dialog } from "../../../components/ui/dialog";
import {
  DELETE_WORKFLOW_CONFIRM_TEXT,
  DeleteWorkflowConfirmation,
} from "./DeleteWorkflowDialog";

test("requires typed confirmation before deleting a workflow", () => {
  const html = renderToString(
    <Dialog open>
      <DeleteWorkflowConfirmation
        workflowName="Build a feature"
        isDeleting={false}
        deleteError={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </Dialog>,
  );

  expect(html).toContain('aria-label="Delete Build a feature"');
  expect(html).toContain("permanently deletes this workflow");
  expect(html).toContain("Type delete to continue");
  expect(html).toContain(DELETE_WORKFLOW_CONFIRM_TEXT);
  expect(html).toContain('disabled=""');
});

test("surfaces deletion errors and busy state", () => {
  const html = renderToString(
    <Dialog open>
      <DeleteWorkflowConfirmation
        workflowName="Build a feature"
        isDeleting={true}
        deleteError="Could not delete workflow."
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </Dialog>,
  );

  expect(html).toContain("Could not delete workflow.");
  expect(html).toContain("Deleting…");
});
