import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  lowPrivilegeCommand,
  nativeSource,
  ProtectedSupervisor,
  supervisorConfigSchema,
  supervisorReceiptSchema,
} from "./supervisor.ts";

const exec = promisify(execFile);
const settings = {
  version: "aa-supervisor/1" as const,
  nativeUid: 1000,
  nativeGid: 1000,
  nativeHome: "/home/native",
  codexBinary: "/usr/local/bin/codex",
  workRoot: "/var/lib/agents-assemble-workspaces",
  controlRoot: "/var/lib/agents-assemble-supervisor",
  runnerDirectory: "/var/lib/agents-assemble-runner",
  helperDirectory: "/opt/agents-assemble/supervisor" as const,
  path: "/usr/bin:/bin",
};
describe("optional protected supervisor public boundary", () => {
  it("rejects root workloads, unknown configuration and unqualified success claims", () => {
    expect(supervisorConfigSchema.safeParse({ ...settings, nativeUid: 0 }).success).toBe(false);
    expect(supervisorConfigSchema.safeParse({ ...settings, automaticTakeover: true }).success).toBe(
      false,
    );
    expect(
      supervisorReceiptSchema.safeParse({
        status: "stopped",
        writerCoverage: "complete",
        automaticTakeover: true,
      }).success,
    ).toBe(false);
    if (process.getuid?.() !== 0)
      expect(() => new ProtectedSupervisor(settings)).toThrow("protected_controller_requires_root");
  });
  it("wraps ordinary subprocesses with UID, GID, empty groups and no-new-privileges", () => {
    expect(lowPrivilegeCommand("/usr/bin/git", ["status"], settings)).toEqual({
      command: "/usr/bin/setpriv",
      args: [
        "--reuid=1000",
        "--regid=1000",
        "--clear-groups",
        "--no-new-privs",
        "--",
        "/usr/bin/git",
        "status",
      ],
    });
    expect(nativeSource(settings)).toEqual({
      HOME: "/home/native",
      PATH: "/usr/bin:/bin",
      USER: "1000",
      LANG: "C.UTF-8",
    });
  });
  it("runs actual Unix descriptor and protected protocol rejection tests without claiming root qualification", async () => {
    const result = await exec(
      "python3",
      [
        "-m",
        "unittest",
        "discover",
        "-s",
        "packages/runner/supervisor",
        "-p",
        "test_supervisor.py",
      ],
      { timeout: 10000 },
    );
    expect(result.stderr).toContain("OK");
    const diagnosis = JSON.parse(
      (await exec("python3", ["packages/runner/supervisor/supervisor.py", "diagnose"])).stdout,
    );
    expect(diagnosis).toMatchObject({
      version: "aa-supervisor/1",
      qualification: "opt_in_required",
      writerCoverage: "incomplete",
      automaticTakeover: false,
    });
  });
});
