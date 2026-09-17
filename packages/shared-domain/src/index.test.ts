import { describe, expect, test } from "bun:test";
import {
  isDaemonReachable,
  resolveDaemonLiveStatus,
} from "./index";

describe("isDaemonReachable", () => {
  test("only online daemons are reachable", () => {
    expect(isDaemonReachable("online")).toBe(true);
    expect(isDaemonReachable("offline")).toBe(false);
    expect(isDaemonReachable("unknown")).toBe(false);
    expect(isDaemonReachable("busy")).toBe(false);
  });
});

describe("resolveDaemonLiveStatus", () => {
  test("a connected socket means online regardless of persisted status", () => {
    expect(resolveDaemonLiveStatus("offline", true)).toBe("online");
  });

  test("a silent socket falls back to offline", () => {
    expect(resolveDaemonLiveStatus("online", false)).toBe("offline");
  });

  test("a silent busy daemon stays busy", () => {
    expect(resolveDaemonLiveStatus("busy", false)).toBe("busy");
  });

  test("a never-seen daemon stays unknown", () => {
    expect(resolveDaemonLiveStatus("unknown", false)).toBe("unknown");
  });
});

describe("device authorization", () => {
  test("accepts a well-formed user code with or without hyphen", async () => {
    const mod = await import("./index");
    expect(mod.isUserCodeValid("ABCD-2345")).toBe(true);
    expect(mod.isUserCodeValid("ABCD2345")).toBe(true);
  });

  test("rejects ambiguous characters and short codes", async () => {
    const mod = await import("./index");
    expect(mod.isUserCodeValid("ABCD-123O")).toBe(false);
    expect(mod.isUserCodeValid("AB12")).toBe(false);
  });

  test("polling is gated on pending status, expiry, and interval", async () => {
    const mod = await import("./index");
    expect(mod.canPollDeviceAuthorization("pending", 6000, 60_000, 0, 5000)).toBe(true);
    expect(mod.canPollDeviceAuthorization("pending", 3000, 60_000, 0, 5000)).toBe(false);
    expect(mod.canPollDeviceAuthorization("approved", 6000, 60_000, 0, 5000)).toBe(false);
    expect(mod.canPollDeviceAuthorization("pending", 61_000, 60_000, 0, 5000)).toBe(false);
  });

  test("approval requires pending status, live code, and matching codes", async () => {
    const mod = await import("./index");
    expect(mod.canApproveDeviceAuthorization("pending", "ABCD-2345", "abcd2345", 1000, 60_000)).toBe(true);
    expect(mod.canApproveDeviceAuthorization("pending", "ABCD-2345", "WXYZ-6789", 1000, 60_000)).toBe(false);
    expect(mod.canApproveDeviceAuthorization("approved", "ABCD-2345", "ABCD-2345", 1000, 60_000)).toBe(false);
    expect(mod.canApproveDeviceAuthorization("pending", "ABCD-2345", "ABCD-2345", 61_000, 60_000)).toBe(false);
  });
});

describe("stable daemon channel", () => {
  test("reuses stored identity when the API URL matches", async () => {
    const { shouldReuseDaemonIdentity } = await import("./index");
    expect(shouldReuseDaemonIdentity({ factoryApiUrl: "http://api" }, "http://api")).toBe(true);
  });

  test("mints fresh identity when the API URL differs or credentials are missing", async () => {
    const { shouldReuseDaemonIdentity } = await import("./index");
    expect(shouldReuseDaemonIdentity({ factoryApiUrl: "http://other" }, "http://api")).toBe(false);
    expect(shouldReuseDaemonIdentity(null, "http://api")).toBe(false);
  });

  test("detects a machine rename on hello", async () => {
    const { hasDaemonMachineNameChanged } = await import("./index");
    expect(hasDaemonMachineNameChanged("old-name", "new-name")).toBe(true);
    expect(hasDaemonMachineNameChanged("same", "same")).toBe(false);
  });
});

describe("compareDaemonIds", () => {
  test("orders daemon ids lexicographically for stable pagination", async () => {
    const { compareDaemonIds } = await import("./index");
    expect([...["daemon-c", "daemon-a", "daemon-b"]].sort(compareDaemonIds)).toEqual(["daemon-a", "daemon-b", "daemon-c"]);
    expect(compareDaemonIds("daemon-a", "daemon-a")).toBe(0);
  });
});

describe("project workspaces", () => {
  test("only absolute paths are valid project paths", async () => {
    const mod = await import("./index");
    expect(mod.isAbsoluteProjectPath("/tmp/checkout")).toBe(true);
    expect(mod.isAbsoluteProjectPath("relative/path")).toBe(false);
    expect(mod.isAbsoluteProjectPath("")).toBe(false);
  });

  test("runs are gated on a valid git status", async () => {
    const mod = await import("./index");
    expect(mod.canRunInProject("valid")).toBe(true);
    expect(mod.canRunInProject("not-a-repo")).toBe(false);
    expect(mod.canRunInProject("missing-path")).toBe(false);
    expect(mod.describeProjectBlockedReason("valid")).toBeNull();
    expect(mod.describeProjectBlockedReason("not-a-repo")).toBe("Project path is not a git repository.");
    expect(mod.mapGitStatusToErrorCode("missing-path")).toBe("PROJECT_NOT_FOUND");
    expect(mod.mapGitStatusToErrorCode("not-a-repo")).toBe("NOT_A_GIT_REPO");
  });

  test("projects track an enabled-workflow allow-list", async () => {
    const mod = await import("./index");
    const base = { projectId: "p1", name: "site", absolutePath: "/tmp/site", daemonId: "d1", gitStatus: "valid" as const, blockedReason: null, enabledWorkflowIds: [] as string[] };
    expect(mod.canEnableWorkflowForProject(base, "workflow-a")).toBe(true);
    expect(mod.canEnableWorkflowForProject({ ...base, enabledWorkflowIds: ["workflow-a"] }, "workflow-a")).toBe(false);
    expect(mod.isWorkflowEnabledForProject({ ...base, enabledWorkflowIds: ["workflow-a"] }, "workflow-a")).toBe(true);
  });


});

describe("daemon deregistration", () => {
  test("deregistered status is never reachable", async () => {
    const mod = await import("./index");
    expect(mod.isDaemonDeregistered("deregistered")).toBe(true);
    expect(mod.isDaemonDeregistered("online")).toBe(false);
    expect(mod.isDaemonReachable("deregistered")).toBe(false);
  });

  test("online and offline daemons are deregisterable, deregistered and unknown are not", async () => {
    const mod = await import("./index");
    expect(mod.canDeregisterDaemon("online")).toBe(true);
    expect(mod.canDeregisterDaemon("offline")).toBe(true);
    expect(mod.canDeregisterDaemon("deregistered")).toBe(false);
    expect(mod.canDeregisterDaemon("unknown")).toBe(false);
  });

  test("deregistered daemons stay deregistered and never become reachable", async () => {
    const mod = await import("./index");
    expect(mod.resolveDaemonLiveStatus("deregistered", true)).toBe("deregistered");
    expect(mod.resolveDaemonLiveStatus("deregistered", false)).toBe("deregistered");
    expect(mod.isDaemonReachable("deregistered")).toBe(false);
  });
});
