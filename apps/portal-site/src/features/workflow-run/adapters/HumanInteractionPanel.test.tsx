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
