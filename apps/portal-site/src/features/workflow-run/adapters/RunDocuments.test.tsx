import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { RunDocuments } from "./RunDocuments";

test("document viewer shows exact approved revisions and producer while suppressing raw HTML", () => {
  const html = renderToString(
    <RunDocuments
      documents={[
        {
          revisionId: "revision-1",
          runId: "run-1",
          documentId: "plan",
          name: "Implementation plan",
          revision: 1,
          executionId: "execution-1",
          activityId: "plan-activity",
          content:
            "# Plan\n\nKeep the original checkout unchanged.\n\n<script>alert('bad')</script>\n\n[unsafe](javascript:alert(1))",
          consumedRevisionIds: ["requirements-r1"],
          createdAt: "2026-09-15T12:00:00.000Z",
        },
      ]}
      approvedRevisionIds={["revision-1"]}
    />,
  );
  expect(html).toContain("Implementation plan");
  expect(html).toContain("revision-1");
  expect(html).toContain("execution-1");
  expect(html).toContain("requirements-r1");
  expect(html).toContain("Approval includes this revision");
  expect(html).toContain("<h1>Plan</h1>");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="javascript:');
});
