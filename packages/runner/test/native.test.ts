import { describe, expect, it } from "vitest";
import { nativeEnvironment, redactOutput } from "../src/native.ts";

describe("native launch boundary", () => {
  it("keeps native login location without proxying model or service credentials", () => {
    const result = nativeEnvironment(
      { NODE_ENV: "development" },
      {
        HOME: "/home/native",
        PATH: "/usr/bin",
        OPENAI_API_KEY: "never-copy",
        AA_TOKEN: "never-copy",
        AWS_SECRET_ACCESS_KEY: "never-copy",
      },
    );
    expect(result).toEqual({ HOME: "/home/native", PATH: "/usr/bin", NODE_ENV: "development" });
    expect(() => nativeEnvironment({ NODE_OPTIONS: "--require=untrusted" })).toThrow(
      "forbidden_environment_binding",
    );
    expect(() => nativeEnvironment({ OPENAI_API_KEY: "key" })).toThrow(
      "forbidden_environment_binding",
    );
  });
  it("redacts resolved values and truncates bytes with visible markers", () => {
    expect(redactOutput("secret=abcdabcd", ["abcdabcd"])).toEqual({
      text: "secret=[REDACTED]",
      truncated: false,
    });
    expect(redactOutput("ééé", [], 4)).toEqual({ text: "éé", truncated: true });
  });
});
