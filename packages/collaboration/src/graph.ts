import { randomUUID } from "node:crypto";
import {
  canonical,
  type Definition,
  DefinitionError,
  type Json,
  jsonSchema,
  type Node,
  validateDefinition,
} from "@aa/catalog/definition";
import * as Y from "yjs";
import { z } from "zod";

type Shared = Y.Map<unknown>;
const structural = new Set(["children", "branches", "cases", "otherwise", "body"]);
function shared(value: Json): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const map = new Y.Map<unknown>();
    for (const [key, item] of Object.entries(value)) map.set(key, shared(item));
    return map;
  }
  return JSON.stringify(value);
}
function materialize(value: unknown): Json {
  if (value instanceof Y.Map)
    return Object.fromEntries([...value.entries()].map(([key, item]) => [key, materialize(item)]));
  if (typeof value !== "string")
    throw new DefinitionError("graph_conflict", "Invalid shared field encoding");
  return jsonSchema.parse(JSON.parse(value));
}
function entity(doc: Y.Doc, entityId: string): Shared {
  const found = doc.getMap<Shared>("entities").get(entityId);
  if (!found || found.get("deleted") === true)
    throw new DefinitionError("graph_conflict", "Missing or deleted graph entity");
  return found;
}
function slot(doc: Y.Doc, entityId: string, name: string): Y.Array<string> {
  const slots = entity(doc, entityId).get("slots");
  if (!(slots instanceof Y.Map))
    throw new DefinitionError("graph_conflict", "Missing structural slots");
  const found = slots.get(name);
  if (!(found instanceof Y.Array))
    throw new DefinitionError("graph_conflict", "Unknown structural slot");
  return found;
}
function addNode(doc: Y.Doc, node: Node | { when: unknown; then: Node }): string {
  const entityId = randomUUID();
  const record = new Y.Map<unknown>();
  const fields = new Y.Map<unknown>();
  const slots = new Y.Map<Y.Array<string>>();
  record.set("fields", fields);
  record.set("slots", slots);
  doc.getMap<Shared>("entities").set(entityId, record);
  if ("when" in node) {
    fields.set("case", JSON.stringify(true));
    fields.set("when", shared(jsonSchema.parse(node.when)));
    const children = new Y.Array<string>();
    slots.set("then", children);
    children.push([addNode(doc, node.then)]);
  } else {
    for (const [key, value] of Object.entries(node))
      if (!structural.has(key)) fields.set(key, shared(jsonSchema.parse(value)));
    const addSlot = (name: string, children: (Node | { when: unknown; then: Node })[]) => {
      const list = new Y.Array<string>();
      slots.set(name, list);
      list.push(children.map((child) => addNode(doc, child)));
    };
    if (node.type === "sequence") addSlot("children", node.children);
    else if (node.type === "parallel") addSlot("branches", node.branches);
    else if (node.type === "choose") {
      addSlot("cases", node.cases);
      addSlot("otherwise", [node.otherwise]);
    } else if (node.type === "repeat" || node.type === "forEach") addSlot("body", [node.body]);
  }
  return entityId;
}
export function graphDocument(definition: Definition): Y.Doc {
  const doc = new Y.Doc();
  const { body, ...envelope } = definition;
  doc.transact(() => {
    doc.getMap("graph").set("envelope", shared(jsonSchema.parse(envelope)));
    doc.getMap("graph").set("root", addNode(doc, body));
  });
  return doc;
}
export function graphSnapshot(doc: Y.Doc) {
  return {
    root: String(doc.getMap("graph").get("root")),
    entities: [...doc.getMap<Shared>("entities").entries()].map(([entityId, record]) => ({
      entityId,
      deleted: record.get("deleted") === true,
      fields: materialize(record.get("fields")),
      slots: Object.fromEntries(
        [...(record.get("slots") as Y.Map<Y.Array<string>>).entries()].map(([name, children]) => [
          name,
          children.toArray(),
        ]),
      ),
    })),
  };
}
export function graphDefinition(doc: Y.Doc, validate = true): Definition {
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (entityId: string): unknown => {
    if (active.has(entityId) || visited.has(entityId))
      throw new DefinitionError("graph_conflict", "Cycle or duplicate executable placement");
    active.add(entityId);
    visited.add(entityId);
    const record = entity(doc, entityId);
    const fields = materialize(record.get("fields"));
    if (!fields || typeof fields !== "object" || Array.isArray(fields))
      throw new DefinitionError("graph_conflict", "Graph fields must be an object");
    const values: Record<string, unknown> = { ...fields };
    const slots = record.get("slots") as Y.Map<Y.Array<string>>;
    const expected =
      fields.case === true
        ? ["then"]
        : fields.type === "sequence"
          ? ["children"]
          : fields.type === "parallel"
            ? ["branches"]
            : fields.type === "choose"
              ? ["cases", "otherwise"]
              : fields.type === "repeat" || fields.type === "forEach"
                ? ["body"]
                : [];
    if (canonical([...slots.keys()].sort()) !== canonical(expected.sort()))
      throw new DefinitionError("graph_conflict", "Structural slots do not match node kind");
    for (const [name, children] of slots.entries()) {
      const singleton = ["then", "otherwise", "body"].includes(name);
      if (singleton && children.length !== 1)
        throw new DefinitionError("graph_conflict", `Slot ${name} requires exactly one child`);
      const nested = children.toArray().map(visit);
      values[name] = singleton ? nested[0] : nested;
    }
    if (fields.case === true) delete values.case;
    active.delete(entityId);
    return values;
  };
  const body = visit(String(doc.getMap("graph").get("root")));
  for (const [entityId, record] of doc.getMap<Shared>("entities").entries())
    if (record.get("deleted") !== true && !visited.has(entityId))
      throw new DefinitionError("graph_conflict", "Unreachable live graph entity");
  const envelope = materialize(doc.getMap("graph").get("envelope"));
  const value = { ...(envelope as Record<string, Json>), body };
  return validate ? validateDefinition(value) : (value as Definition);
}
const graphOperationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("remove-field"),
    entityId: z.uuid(),
    path: z.array(z.string().min(1).max(160)).min(1).max(32),
  }),
  z.strictObject({
    type: z.literal("field"),
    entityId: z.string().uuid(),
    path: z.array(z.string().min(1).max(160)).min(1).max(32),
    value: z.unknown(),
  }),
  z.strictObject({
    type: z.literal("move"),
    entityId: z.string().uuid(),
    from: z.strictObject({ parent: z.string().uuid(), slot: z.string() }),
    to: z.strictObject({
      parent: z.string().uuid(),
      slot: z.string(),
      index: z.number().int().min(0),
    }),
  }),
  z.strictObject({
    type: z.literal("delete"),
    entityId: z.string().uuid(),
    from: z.strictObject({ parent: z.string().uuid(), slot: z.string() }),
  }),
  z.strictObject({
    type: z.literal("insert"),
    parent: z.string().uuid(),
    slot: z.string(),
    index: z.number().int().min(0),
    node: z.unknown(),
  }),
]);
export const graphCommandSchema = z.union([
  graphOperationSchema,
  z.strictObject({
    type: z.literal("batch"),
    commands: z.array(graphOperationSchema).min(1).max(100),
  }),
]);
export type GraphCommand = z.infer<typeof graphCommandSchema>;
export function graphWriteSet(command: GraphCommand): string[] {
  if (command.type === "batch") return command.commands.flatMap(graphWriteSet);
  if (command.type === "field" || command.type === "remove-field")
    return [`entity/${command.entityId}/fields/${command.path.map(encodeURIComponent).join("/")}`];
  if (command.type === "insert") return [`placement/${command.parent}/${command.slot}`];
  return [
    `entity/${command.entityId}`,
    `placement/${command.from.parent}/${command.from.slot}`,
    ...(command.type === "move" ? [`placement/${command.to.parent}/${command.to.slot}`] : []),
  ];
}
export function writesOverlap(left: string[], right: string[]): boolean {
  return left.some((a) =>
    right.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)),
  );
}
export function applyGraphCommand(doc: Y.Doc, command: GraphCommand): void {
  if (command.type === "batch") {
    for (const item of command.commands) applyGraphCommand(doc, item);
    return;
  }
  if (command.type === "field" || command.type === "remove-field") {
    if (structural.has(command.path[0]) || command.path[0] === "case")
      throw new DefinitionError("graph_conflict", "Structural slots require structural commands");
    let map = entity(doc, command.entityId).get("fields") as Shared;
    for (const key of command.path.slice(0, -1)) {
      const next = map.get(key);
      if (!(next instanceof Y.Map))
        throw new DefinitionError("graph_conflict", "Field parent is not a shared object");
      map = next;
    }
    if (command.type === "remove-field") map.delete(command.path.at(-1) as string);
    else map.set(command.path.at(-1) as string, shared(jsonSchema.parse(command.value)));
    return;
  }
  if (command.type === "insert") {
    const target = slot(doc, command.parent, command.slot);
    if (command.index > target.length)
      throw new DefinitionError("graph_conflict", "Invalid ordered insertion position");
    const node = jsonSchema.parse(command.node);
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      (command.slot === "cases"
        ? !("when" in node && "then" in node)
        : typeof node.id !== "string" || typeof node.type !== "string")
    )
      throw new DefinitionError("graph_conflict", "Insert requires a structured node");
    target.insert(command.index, [addNode(doc, node as Node | { when: unknown; then: Node })]);
    return;
  }
  const source = slot(doc, command.from.parent, command.from.slot);
  const index = source.toArray().indexOf(command.entityId);
  if (index < 0 || source.toArray().filter((id) => id === command.entityId).length !== 1)
    throw new DefinitionError("graph_conflict", "Source placement no longer matches");
  if (command.type === "move") {
    const target = slot(doc, command.to.parent, command.to.slot);
    if (command.to.index > target.length)
      throw new DefinitionError("graph_conflict", "Invalid destination position");
    source.delete(index);
    target.insert(Math.min(command.to.index, target.length), [command.entityId]);
  } else {
    source.delete(index);
    const tombstone = (id: string) => {
      const record = entity(doc, id);
      for (const children of (record.get("slots") as Y.Map<Y.Array<string>>).values())
        for (const child of children.toArray()) tombstone(child);
      record.set("deleted", true);
    };
    tombstone(command.entityId);
  }
}
