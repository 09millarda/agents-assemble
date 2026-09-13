import type { Node } from "@aa/catalog/definition";
import { createContext } from "react";
export const GraphEditingContext = createContext<((before: Node, after: Node) => void) | undefined>(
  undefined,
);
