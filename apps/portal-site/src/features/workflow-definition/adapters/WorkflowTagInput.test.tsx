import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { WorkflowTagInput } from "./WorkflowTagInput";

test("workflow tag input renders existing tokens and delimiter guidance", () => {
  const html = renderToString(
    <WorkflowTagInput tags={["delivery", "planning"]} onChange={() => {}} />,
  );

  expect(html).toContain("delivery");
  expect(html).toContain("planning");
  expect(html).toContain("Add a tag, then press Enter or comma");
  expect(html).toContain('aria-label="Remove workflow tag: delivery"');
});
