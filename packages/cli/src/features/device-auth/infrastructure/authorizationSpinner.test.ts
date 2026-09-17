import { describe, expect, test } from "bun:test";
import { createAuthorizationWaitIndicator } from "./authorizationSpinner";

function ttyOutput() {
  const written: string[] = [];
  return {
    written,
    stream: { isTTY: true, write: (chunk: string): void => { written.push(chunk); } },
  };
}

describe("createAuthorizationWaitIndicator", () => {
  test("stop without start is a no-op", () => {
    const { stream } = ttyOutput();
    const indicator = createAuthorizationWaitIndicator(stream);
    expect(() => indicator.stop()).not.toThrow();
  });

  test("animates while waiting and clears the line on stop", async () => {
    const { stream, written } = ttyOutput();
    const indicator = createAuthorizationWaitIndicator(stream, 5);
    indicator.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    indicator.stop();
    expect(written.some((chunk) => chunk.includes("Waiting for authorization"))).toBe(true);
    expect(written[written.length - 1]).toBe("\r\x1b[K\n");
  });

  test("double start and double stop are safe", async () => {
    const { stream, written } = ttyOutput();
    const indicator = createAuthorizationWaitIndicator(stream, 5);
    indicator.start();
    indicator.start();
    await new Promise((resolve) => setTimeout(resolve, 15));
    indicator.stop();
    indicator.stop();
    expect(written.some((chunk) => chunk.includes("Waiting for authorization"))).toBe(true);
  });

  test("non-TTY output falls back to a static line", () => {
    const written: string[] = [];
    const indicator = createAuthorizationWaitIndicator({ write: (chunk: string): void => { written.push(chunk); } });
    indicator.start();
    indicator.stop();
    expect(written).toEqual(["Waiting for authorization...\n"]);
  });
});
