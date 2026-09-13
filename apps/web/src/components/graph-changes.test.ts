import { starterPlaybook } from "@aa/catalog/starters";
import {
  applyGraphCommand,
  graphDefinition,
  graphDocument,
  graphSnapshot,
} from "@aa/collaboration/graph";
import { expect, it } from "vitest";
import { type GraphSnapshot, graphChanges } from "./graph-changes";

it("turns visual node field and ordered placement edits into the equivalent semantic graph", () => {
  const definition = starterPlaybook("new-feature"),
    doc = graphDocument(definition);
  if (definition.body.type !== "sequence") throw new Error("Expected starter sequence");
  const before = definition.body,
    after = { ...before, children: [...before.children].reverse() };
  const command = graphChanges(graphSnapshot(doc) as GraphSnapshot, before, after);
  if (!command) throw new Error("Expected ordered semantic edits");
  applyGraphCommand(doc, command);
  expect(graphDefinition(doc, false).body).toEqual(after);
  const first = after.children[0],
    renamed = { ...first, id: "reviewedIdentity", presentation: { label: "Reviewed exact node" } };
  const fields = graphChanges(graphSnapshot(doc) as GraphSnapshot, first, renamed);
  if (!fields) throw new Error("Expected field batch");
  applyGraphCommand(doc, fields);
  expect(
    graphSnapshot(doc).entities.some((item) =>
      JSON.stringify(item.fields).includes("reviewedIdentity"),
    ),
  ).toBe(true);
});
