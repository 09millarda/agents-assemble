import { createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function createPortalRouter(browserWindow?: unknown) {
  const history = createHashHistory(browserWindow ? { window: browserWindow } : undefined);
  return createRouter({ routeTree, history });
}
