import { describe, expect, test } from "bun:test";
import { generateMachineName, resolveMachineName } from "./machineName";

describe("resolveMachineName", () => {
  test("explicit flag wins over env and generated names", () => {
    expect(resolveMachineName("flag-name", { envValue: "env-name", readHostname: () => "host", randomSuffix: () => "abcd" })).toBe("flag-name");
  });

  test("env wins over generated names", () => {
    expect(resolveMachineName(undefined, { envValue: "env-name", readHostname: () => "host", randomSuffix: () => "abcd" })).toBe("env-name");
  });

  test("blank flag and env fall through to generation", () => {
    const name = resolveMachineName("  ", { envValue: "  ", readHostname: () => "MyHost", randomSuffix: () => "a1b2" });
    expect(name).toBe("myhost-a1b2");
  });

  test("generated name derives from the sanitized hostname", () => {
    const name = generateMachineName({ readHostname: () => "My Workstation!", randomSuffix: () => "x9y8" });
    expect(name).toBe("my-workstation-x9y8");
    expect(name).toMatch(/^[a-z0-9-]+-[a-z0-9]{4}$/);
  });

  test("generated name falls back to machine when the hostname is empty", () => {
    expect(generateMachineName({ readHostname: () => "", randomSuffix: () => "qwer" })).toBe("machine-qwer");
  });
});
