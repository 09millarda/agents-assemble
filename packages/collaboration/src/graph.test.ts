import { starterPlaybook } from "@aa/catalog/starters";
import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyGraphCommand,
  graphDefinition,
  graphDocument,
  graphSnapshot,
  graphWriteSet,
  writesOverlap,
} from "./graph.ts";

it("preserves complete nested starter definitions through real Yjs state", () => {
  const source = starterPlaybook("bug-fix");
  const doc = graphDocument(source);
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
  expect(graphDefinition(replica)).toEqual(source);
  expect(graphSnapshot(replica).entities.length).toBeGreaterThan(30);
});
it("merges independent field edits and detects structural/field overlap", () => {
  const doc = graphDocument(starterPlaybook("new-feature"));
  const snapshot = graphSnapshot(doc);
  const target = snapshot.entities.find(
    (item) => (item.fields as { id?: string }).id === "discovery",
  );
  if (!target) throw new Error("Missing fixture discovery node");
  const left = new Y.Doc();
  const right = new Y.Doc();
  Y.applyUpdate(left, Y.encodeStateAsUpdate(doc));
  Y.applyUpdate(right, Y.encodeStateAsUpdate(doc));
  const a = {
    type: "field" as const,
    entityId: target.entityId,
    path: ["runtime"],
    value: "author",
  };
  const b = {
    type: "field" as const,
    entityId: target.entityId,
    path: ["id"],
    value: "newDiscovery",
  };
  expect(writesOverlap(graphWriteSet(a), graphWriteSet(b))).toBe(false);
  applyGraphCommand(left, a);
  applyGraphCommand(right, b);
  Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  expect(graphSnapshot(left)).toEqual(graphSnapshot(right));
  expect(writesOverlap(graphWriteSet(a), [`entity/${target.entityId}`])).toBe(true);
  expect(() => applyGraphCommand(doc, { ...a, path: ["children"], value: [] })).toThrow(
    /Structural/,
  );
});
it("rejects duplicate placements instead of choosing an executable winner", () => {
  const doc = graphDocument(starterPlaybook("new-feature"));
  const snapshot = graphSnapshot(doc);
  const root = doc.getMap<Y.Map<unknown>>("entities").get(snapshot.root);
  if (!root) throw new Error("Missing fixture root");
  const children = (root.get("slots") as Y.Map<Y.Array<string>>).get("children");
  if (!children) throw new Error("Missing fixture children");
  children.push([children.get(0)]);
  expect(() => graphDefinition(doc)).toThrow(/duplicate/);
});
