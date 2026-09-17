import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { DaemonDetails } from "@factory/shared-domain";
import { DaemonDetail, describeCapacityGuidance } from "./DaemonDetail";

const details: DaemonDetails = {
  daemonId: "daemon-1",
  machineName: "studio-machine",
  status: "online",
  configuration: {
    desired: {
      displayName: "Studio builder",
      maxParallelHarnesses: 6,
      location: "London studio",
      deviceLabel: "Threadripper tower",
      purpose: "Parallel feature builds",
      ownerTeam: "Platform",
      tags: ["gpu", "primary"],
      notes: "Keep ventilated",
    },
    applied: {
      displayName: "Studio builder",
      maxParallelHarnesses: 4,
      location: "London studio",
      deviceLabel: "Threadripper tower",
      purpose: "Parallel feature builds",
      ownerTeam: "Platform",
      tags: ["gpu", "primary"],
      notes: "Keep ventilated",
    },
    revision: 7,
    appliedRevision: 6,
    status: "pending",
    failureReason: null,
  },
  runtimeFacts: {
    machineName: "studio-machine",
    operatingSystem: "linux",
    architecture: "x64",
    cpuCount: 16,
    memoryBytes: 32_000_000_000,
    daemonVersion: "0.0.0",
    harnessVersions: [{ harness: "codex", version: "0.154.0" }],
    capabilities: [],
    lastSeenAt: "2026-09-17T12:00:00.000Z",
  },
  telemetry: {
    activeHarnesses: 3,
    queuedCommands: 2,
    desiredMaxParallelHarnesses: 6,
    appliedMaxParallelHarnesses: 4,
  },
};

test("daemon detail exposes overview, editable desired state, resource guidance, and raw-log disclosure", () => {
  const registry = {
    getDaemon: async () => details,
    saveDaemonConfiguration: async () => details,
    buildDaemonLogStreamUrl: () => "http://factory/logs",
  };
  const html = (["overview", "configuration", "logs"] as const)
    .map((initialTab) => renderToString(
      <DaemonDetail
        initialDetails={details}
        registry={registry}
        initialTab={initialTab}
      />,
    ))
    .join("\n")
    .replaceAll("<!-- -->", "");

  for (const text of [
    "Overview",
    "Configuration",
    "Live Logs",
    "Refresh daemon",
    "Studio builder",
    "studio-machine",
    "3 active",
    "2 queued",
    "Desired capacity",
    "Applied capacity",
    "Configuration pending",
    "Last applied values",
    "4 harnesses",
    "Exact raw diagnostics",
    "may contain sensitive workflow or machine data",
    "I understand — start streaming",
  ]) expect(html).toContain(text);
  expect(html).toContain('min="1"');
  expect(html).toContain('max="10"');
});

test("capacity guidance remains advisory and scales with requested parallelism", () => {
  expect(describeCapacityGuidance(1)).toContain("modest");
  expect(describeCapacityGuidance(5)).toContain("8 GB");
  expect(describeCapacityGuidance(10)).toContain("16 GB");
});

test("offline daemon does not expose live logs", () => {
  const html = renderToString(
    <DaemonDetail
      initialDetails={{ ...details, status: "offline" }}
      initialTab="logs"
      registry={{
        getDaemon: async () => ({ ...details, status: "offline" }),
        saveDaemonConfiguration: async () => details,
        buildDaemonLogStreamUrl: () => "http://factory/logs",
      }}
    />,
  ).replaceAll("<!-- -->", "");

  expect(html).not.toContain("Live Logs");
  expect(html).toContain("Live logs are only available while this daemon is online.");
});

test("failed desired configuration keeps the user's values beside the last applied values and reason", () => {
  const failed: DaemonDetails = {
    ...details,
    configuration: {
      ...details.configuration,
      status: "failed",
      failureReason: "This daemon rejected the requested capacity.",
    },
  };
  const html = renderToString(
    <DaemonDetail
      initialDetails={failed}
      initialTab="configuration"
      registry={{
        getDaemon: async () => failed,
        saveDaemonConfiguration: async () => failed,
        buildDaemonLogStreamUrl: () => "http://factory/logs",
      }}
    />,
  ).replaceAll("<!-- -->", "");

  expect(html).toContain("Configuration failed");
  expect(html).toContain("This daemon rejected the requested capacity.");
  expect(html).toContain('value="6"');
  expect(html).toContain("4 harnesses");
});
