import { describe, expect, it } from "vitest";
import { authorityDigest, payloadDigest, verifyCommand } from "../src/protocol.ts";
import { makeCommand } from "./support.ts";

describe("runner protocol", () => {
  it("binds Unicode payload bytes and exact ASCII authority separately", () => {
    const command = makeCommand();
    expect(verifyCommand(command)).toEqual(command);
    expect(authorityDigest(command)).toMatch(/^[a-f0-9]{64}$/);
    expect(payloadDigest({ a: 1, b: 2 })).toBe(payloadDigest({ b: 2, a: 1 }));
    expect(() =>
      verifyCommand({ ...command, payload: { ...command.payload, prompt: "changed" } }),
    ).toThrow("payload_digest_mismatch");
  });
  it("rejects unknown authority fields and unsupported runtime profiles", () => {
    expect(() => verifyCommand({ ...makeCommand(), unsafe: true })).toThrow();
    const command = makeCommand();
    expect(() =>
      verifyCommand({
        ...command,
        payload: {
          ...command.payload,
          runtime: { ...command.payload.runtime, trustedRunner: false },
        },
      }),
    ).toThrow();
  });
});
