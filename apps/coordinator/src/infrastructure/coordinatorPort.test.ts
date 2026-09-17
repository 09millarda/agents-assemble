import { expect, test } from "bun:test";
import { resolveCoordinatorPort } from "./coordinatorPort";

test("uses the coordinator port when the shared API port is configured", () => {
  expect(
    resolveCoordinatorPort({
      PORT: "3001",
    }),
  ).toBe(3003);
});

test("uses the configured coordinator port", () => {
  expect(resolveCoordinatorPort({ COORDINATOR_PORT: "3098" })).toBe(3098);
});
