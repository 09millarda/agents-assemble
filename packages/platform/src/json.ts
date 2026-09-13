import { z } from "zod";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
function isJson(value: unknown): value is JsonValue {
  let remaining = 100000;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 64) return false;
    if (item === null || typeof item === "boolean" || typeof item === "string") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item !== "object" || ancestors.has(item)) return false;
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      return false;
    ancestors.add(item);
    const valid = Object.values(item).every((entry) => visit(entry, depth + 1));
    ancestors.delete(item);
    return valid;
  }
  return visit(value, 0);
}
// Zod's recursive record parser normalizes some property names. Validate without
// cloning so immutable JSON values retain their exact own keys and digest.
export const jsonValue = z
  .unknown()
  .refine(isJson, "Expected bounded finite JSON") as z.ZodType<JsonValue>;
