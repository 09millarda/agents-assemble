import type { Node } from "@aa/catalog/definition";
import type { GraphCommand } from "@aa/collaboration/graph";
export interface GraphSnapshot {
  root: string;
  entities: {
    entityId: string;
    deleted: boolean;
    fields: Record<string, unknown>;
    slots: Record<string, string[]>;
  }[];
}
type Operation = Exclude<GraphCommand, { type: "batch" }>;
const slots = new Set(["children", "branches", "cases", "otherwise", "body"]);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/** Diff one explicit visual edit against its observed stable entity, preserving unrelated fields. */
export function graphChanges(
  snapshot: GraphSnapshot,
  before: Node,
  after: Node,
): GraphCommand | undefined {
  const entity = snapshot.entities.find((item) => !item.deleted && item.fields.id === before.id);
  if (!entity)
    throw new Error(
      "This node is no longer present in the observed graph. Review the current draft.",
    );
  const commands: Operation[] = [];
  const fields = (
    id: string,
    old: Record<string, unknown>,
    next: Record<string, unknown>,
    path: string[] = [],
  ) => {
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (!path.length && slots.has(key)) continue;
      if (JSON.stringify(old[key]) === JSON.stringify(next[key])) continue;
      const at = [...path, key];
      if (!Object.hasOwn(next, key))
        commands.push({ type: "remove-field", entityId: id, path: at });
      else if (object(old[key]) && object(next[key])) fields(id, old[key], next[key], at);
      else commands.push({ type: "field", entityId: id, path: at, value: next[key] });
    }
  };
  fields(entity.entityId, { ...before }, { ...after });
  for (const [name, ids] of Object.entries(entity.slots)) {
    const original = Reflect.get(before, name),
      updated = Reflect.get(after, name);
    if (JSON.stringify(original) === JSON.stringify(updated)) continue;
    const oldList: unknown[] = Array.isArray(original) ? original : [original];
    const newList: unknown[] = Array.isArray(updated) ? updated : [updated];
    const identity = (value: unknown): unknown =>
      object(value)
        ? name === "cases" && object(value.then)
          ? value.then.id
          : value.id
        : undefined;
    const positions = new Map(
      oldList.map((value, index) => [identity(value), { value, id: ids[index] }]),
    );
    const current = oldList.map(identity);
    for (let index = oldList.length - 1; index >= 0; index--)
      if (!newList.some((value) => identity(value) === identity(oldList[index]))) {
        commands.push({
          type: "delete",
          entityId: ids[index],
          from: { parent: entity.entityId, slot: name },
        });
        current.splice(index, 1);
      }
    newList.forEach((value, index) => {
      const key = identity(value),
        prior = positions.get(key);
      if (!prior) {
        commands.push({ type: "insert", parent: entity.entityId, slot: name, index, node: value });
        current.splice(index, 0, key);
      } else {
        const from = current.indexOf(key);
        if (from !== index) {
          commands.push({
            type: "move",
            entityId: prior.id,
            from: { parent: entity.entityId, slot: name },
            to: { parent: entity.entityId, slot: name, index },
          });
          current.splice(from, 1);
          current.splice(index, 0, key);
        }
        if (name === "cases" && object(prior.value) && object(value))
          fields(prior.id, { when: prior.value.when }, { when: value.when });
      }
    });
  }
  return commands.length === 0
    ? undefined
    : commands.length === 1
      ? commands[0]
      : { type: "batch", commands };
}
