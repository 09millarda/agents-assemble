import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Dialog } from "../../../components/ui/dialog";
import { DeleteStepConfirmation } from "./DeleteStepDialog";

test("step deletion explains its graph impact and offers a safe cancel action", () => {
  const html = renderToString(
    <Dialog open>
      <DeleteStepConfirmation
        stepName="Implement feature"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </Dialog>,
  );

  expect(html).toContain("Delete step?");
  expect(html).toContain("Implement feature");
  expect(html).toContain("clears handoffs that point to it");
  expect(html).toContain("Cancel");
  expect(html).toContain("Delete step");
});
