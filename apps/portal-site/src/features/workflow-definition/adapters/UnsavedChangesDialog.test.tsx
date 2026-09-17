import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Dialog } from "../../../components/ui/dialog";
import { UnsavedChangesConfirmation } from "./UnsavedChangesDialog";

test("unsaved navigation explains the draft loss before leaving", () => {
  const html = renderToString(
    <Dialog open>
      <UnsavedChangesConfirmation onLeave={() => {}} onStay={() => {}} />
    </Dialog>,
  );

  expect(html).toContain("Leave without saving?");
  expect(html).toContain("discard this draft");
  expect(html).toContain("Stay");
  expect(html).toContain("Leave without saving");
});
