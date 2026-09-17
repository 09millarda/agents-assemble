import { expect, test } from "bun:test";
import type {
  DaemonConfiguration,
  DaemonDetails,
} from "@factory/shared-domain";
import { saveDaemonConfiguration } from "./saveDaemonConfiguration";
import type {
  DaemonConfigurationDeliveryPort,
  DaemonConfigurationPort,
} from "../../domain/DaemonConfigurationPort";

const desired: DaemonConfiguration = {
  displayName: "Build machine",
  maxParallelHarnesses: 3,
  location: "London",
  deviceLabel: "Workstation",
  purpose: "Feature delivery",
  ownerTeam: "Platform",
  tags: ["linux", "gpu"],
  notes: "Keep plugged in",
};

test("saving daemon configuration persists user intent before attempting live delivery", async () => {
  const events: string[] = [];
  const saved: DaemonDetails = {
    daemonId: "daemon-1",
    machineName: "studio-machine",
    status: "online",
    configuration: {
      desired,
      applied: null,
      revision: 2,
      appliedRevision: null,
      status: "pending",
      failureReason: null,
    },
    runtimeFacts: null,
    telemetry: null,
  };
  const registry: DaemonConfigurationPort = {
    saveDesiredConfiguration: async (daemonId, configuration) => {
      events.push(`saved:${daemonId}:${configuration.displayName}`);
      return saved;
    },
  };
  const delivery: DaemonConfigurationDeliveryPort = {
    sendConfiguration: (daemonId, revision) => {
      events.push(`sent:${daemonId}:${revision}`);
      return true;
    },
  };

  const result = await saveDaemonConfiguration(
    registry,
    delivery,
    "daemon-1",
    desired,
  );

  expect(result).toEqual({ ok: true, value: saved });
  expect(events).toEqual([
    "saved:daemon-1:Build machine",
    "sent:daemon-1:2",
  ]);
});

test("saving rejects an out-of-range harness capacity without writing", async () => {
  let writes = 0;
  const registry: DaemonConfigurationPort = {
    saveDesiredConfiguration: async () => {
      writes += 1;
      return null;
    },
  };

  const result = await saveDaemonConfiguration(
    registry,
    { sendConfiguration: () => false },
    "daemon-1",
    { ...desired, maxParallelHarnesses: 11 },
  );

  expect(result).toEqual({
    ok: false,
    error: {
      code: "INVALID_DAEMON_CONFIGURATION",
      message: "Parallel harness capacity must be a whole number from 1 to 10.",
    },
  });
  expect(writes).toBe(0);
});
