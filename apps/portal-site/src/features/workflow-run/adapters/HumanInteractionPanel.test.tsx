import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { HumanInteractionPanel } from "./HumanInteractionPanel";

test("publication approval identifies exact revisions and reviewed changes with three explicit choices", () => {
  const html = renderToString(
    <HumanInteractionPanel
      interaction={{
        interactionId: "approval-1",
        executionId: "review-1",
        kind: "approval",
        prompt: "Approve publication",
        outputRevisionIds: ["review-r3"],
        targetActivityId: "publish",
        reviewedTreeHash: "tree-approved",
      }}
      runId="run-1"
      diff="diff --git a/example.ts b/example.ts\n+reviewed content"
      busy={false}
      onRespond={async () => {}}
    />,
  );
  for (const text of [
    "review-r3",
    "tree-approved",
    "+reviewed content",
    "Approve",
    "Request changes",
    "Cancel",
  ])
    expect(html).toContain(text);
});

test("failed-step recovery offers a plain retry without jargon", () => {
  const html = renderToString(
    <HumanInteractionPanel
      interaction={{
        interactionId: "recovery-1",
        executionId: "execution-1",
        kind: "recovery",
        prompt: "The build step stopped before finishing.",
        outputRevisionIds: [],
        targetActivityId: null,
      }}
      runId="run-1"
      busy={false}
      onRespond={async () => {}}
    />,
  );
  for (const text of ["Step failed", "Retry step", "Cancel run"])
    expect(html).toContain(text);
  expect(html.toLowerCase()).not.toContain("reconciliation");
  expect(html).not.toContain("Recovery decision required");
  expect(html).not.toContain("Retry after reconciliation");
});
