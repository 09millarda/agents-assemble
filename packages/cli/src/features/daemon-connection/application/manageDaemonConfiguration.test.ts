import { describe, expect, test } from "bun:test";
import type { DaemonDetails } from "@factory/shared-domain";
import {
  getDaemonConfiguration,
  formatDaemonConfiguration,
  mergeDaemonConfiguration,
  resolveDaemonConfigurationTarget,
  setDaemonConfiguration,
} from "./manageDaemonConfiguration";

const details: DaemonDetails = {
  daemonId: "daemon-1",
  machineName: "machine",
  status: "online",
  configuration: {
    desired: {
      displayName: "Builder",
      maxParallelHarnesses: 2,
      location: "London",
      deviceLabel: "tower",
      purpose: "Builds",
      ownerTeam: "Platform",
      tags: ["fast"],
      notes: "Keep cool",
    },
    applied: null,
    revision: 2,
    appliedRevision: null,
    status: "pending",
    failureReason: null,
  },
  runtimeFacts: null,
  telemetry: null,
};

describe("daemon configuration targeting", () => {
  test("uses the stored credential daemon by default and an explicit daemon id when named", () => {
    const stored = { daemonId: "stored", authToken: "secret", factoryApiUrl: "http://factory/" };
    expect(resolveDaemonConfigurationTarget(stored)).toEqual({
      ok: true,
      value: { daemonId: "stored", factoryApiUrl: "http://factory" },
    });
    expect(resolveDaemonConfigurationTarget(stored, "other")).toEqual({
      ok: true,
      value: { daemonId: "other", factoryApiUrl: "http://factory" },
    });
  });
});

test("named flags merge with current desired configuration and explicit clears empty metadata", () => {
  expect(mergeDaemonConfiguration(details.configuration.desired, {
    displayName: "Studio builder",
    maxParallelHarnesses: 5,
    tags: ["gpu", "quiet"],
    clearLocation: true,
    clearNotes: true,
  })).toEqual({
    displayName: "Studio builder",
    maxParallelHarnesses: 5,
    location: "",
    deviceLabel: "tower",
    purpose: "Builds",
    ownerTeam: "Platform",
    tags: ["gpu", "quiet"],
    notes: "",
  });
});

test("set reads current state then submits one complete configuration without credentials", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Response.json(init?.method === "POST" ? {
      ...details,
      configuration: {
        ...details.configuration,
        desired: JSON.parse(String(init.body)),
        revision: 3,
      },
    } : details);
  };
  const target = { daemonId: "daemon-1", factoryApiUrl: "http://factory" };

  const current = await getDaemonConfiguration(target, fetchImpl as typeof fetch);
  expect(current.ok).toBe(true);
  const updated = await setDaemonConfiguration(
    target,
    { maxParallelHarnesses: 4, clearTags: true },
    fetchImpl as typeof fetch,
  );

  expect(updated.ok && updated.value.configuration.desired.maxParallelHarnesses).toBe(4);
  expect(updated.ok && updated.value.configuration.desired.tags).toEqual([]);
  expect(requests.map(({ url }) => url)).toEqual([
    "http://factory/v1/daemons/daemon-1",
    "http://factory/v1/daemons/daemon-1",
    "http://factory/v1/daemons/daemon-1/configuration",
  ]);
  expect(JSON.stringify(requests)).not.toContain("secret");
  expect(formatDaemonConfiguration(updated.ok ? updated.value : details)).toContain(
    '"maxParallelHarnesses": 4',
  );
  expect(formatDaemonConfiguration(updated.ok ? updated.value : details)).not.toContain("authToken");
});
