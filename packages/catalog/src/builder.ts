import { type Binding, type Definition, type Json, normalizeDefinition } from "./definition.ts";
export const literal = (value: Json): Binding => ({ literal: value });
export const ref = (source: string, pointer = ""): Binding => ({ ref: { source, pointer } });
export const object = (value: Record<string, Binding>): Binding => ({ object: value });
export const array = (...value: Binding[]): Binding => ({ array: value });
export function definePlaybook(value: Definition): Definition {
  return normalizeDefinition(value);
}
