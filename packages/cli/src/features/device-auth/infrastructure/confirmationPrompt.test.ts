import { describe, expect, test } from "bun:test";
import { CONFIRMATION_PROMPT } from "./confirmationPrompt";

describe("CONFIRMATION_PROMPT", () => {
  test("ends with a colon so the cursor sits after it", () => {
    expect(CONFIRMATION_PROMPT).toBe("Hit Enter to continue: ");
  });
});
