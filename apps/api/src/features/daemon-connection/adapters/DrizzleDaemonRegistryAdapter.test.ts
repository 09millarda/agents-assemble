import { describe, expect, test } from "bun:test";
import {
  filterActiveDaemons,
  toDaemonDetails,
  toDaemonSummary,
} from "./DrizzleDaemonRegistryAdapter";

describe("toDaemonSummary", () => {
  test("maps a persistence row to the domain without leaking credentials", () => {
    const summary = toDaemonSummary({ daemonId: "daemon-1", machineName: "workstation", status: "online" });

    expect(summary).toEqual({
      daemonId: "daemon-1",
      machineName: "workstation",
      displayName: "workstation",
      status: "online",
      maxParallelHarnesses: 1,
      appliedMaxParallelHarnesses: null,
      activeHarnesses: 0,
      queuedCommands: 0,
    });
    expect("authTokenHash" in summary).toBe(false);
  });

  test("falls back to unknown when the stored status is null", () => {
    expect(toDaemonSummary({ daemonId: "daemon-2", machineName: "laptop", status: null }).status).toBe("unknown");
  });

  test("passes deregistered rows through the mapper", () => {
    expect(toDaemonSummary({ daemonId: "daemon-9", machineName: "studio", status: "deregistered" })).toEqual({
      daemonId: "daemon-9",
      machineName: "studio",
      displayName: "studio",
      status: "deregistered",
      maxParallelHarnesses: 1,
      appliedMaxParallelHarnesses: null,
      activeHarnesses: 0,
      queuedCommands: 0,
    });
  });
});

describe("filterActiveDaemons", () => {
  test("excludes deregistered rows from default reads", () => {
    const rows = filterActiveDaemons([
      { daemonId: "daemon-1", machineName: "a", status: "online" },
      { daemonId: "daemon-2", machineName: "b", status: "deregistered" },
      { daemonId: "daemon-3", machineName: "c", status: null },
    ]);

    expect(rows.map((row) => row.daemonId)).toEqual(["daemon-1", "daemon-3"]);
  });
});

describe("toDaemonDetails", () => {
  test("separates desired configuration from reported machine identity without exposing credentials", () => {
    const details = toDaemonDetails({
      daemonId: "daemon-1",
      machineName: "reported-host",
      status: "online",
      displayName: "Build machine",
      maxParallelHarnesses: 3,
      metadata: {
        location: "London",
        deviceLabel: "Workstation",
        purpose: "Feature delivery",
        ownerTeam: "Platform",
        tags: ["linux"],
        notes: "Keep plugged in",
      },
      configurationRevision: 4,
      appliedConfiguration: null,
      appliedConfigurationRevision: null,
      configurationApplyStatus: "pending",
      configurationFailureReason: null,
      runtimeFacts: null,
    });

    expect(details).toEqual({
      daemonId: "daemon-1",
      machineName: "reported-host",
      status: "online",
      configuration: {
        desired: {
          displayName: "Build machine",
          maxParallelHarnesses: 3,
          location: "London",
          deviceLabel: "Workstation",
          purpose: "Feature delivery",
          ownerTeam: "Platform",
          tags: ["linux"],
          notes: "Keep plugged in",
        },
        applied: null,
        revision: 4,
        appliedRevision: null,
        status: "pending",
        failureReason: null,
      },
      runtimeFacts: null,
      telemetry: null,
    });
    expect("authTokenHash" in details).toBe(false);
  });

  test("completes legacy partial configuration metadata before returning details", () => {
    const details = toDaemonDetails({
      daemonId: "daemon-legacy",
      machineName: "legacy-host",
      status: "online",
      displayName: "Legacy builder",
      maxParallelHarnesses: 2,
      metadata: {},
      configurationRevision: 1,
      appliedConfiguration: {
        displayName: "Legacy builder",
        maxParallelHarnesses: 2,
      },
      appliedConfigurationRevision: 1,
      configurationApplyStatus: "applied",
      configurationFailureReason: null,
      runtimeFacts: null,
    });

    expect(details.configuration.desired).toEqual({
      displayName: "Legacy builder",
      maxParallelHarnesses: 2,
      location: "",
      deviceLabel: "",
      purpose: "",
      ownerTeam: "",
      tags: [],
      notes: "",
    });
    expect(details.configuration.applied).toEqual(details.configuration.desired);
  });
});
