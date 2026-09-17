import { describe, expect, test } from "bun:test";
import { listDaemons } from "./listDaemons";
import { encodeCursor } from "../../../../infrastructure/http/pagination";
import type { DaemonPresencePort, DaemonRegistryPort } from "../../domain/DaemonConnectionPort";

function summary(daemonId: string, machineName: string, status: "offline" | "unknown") {
  return {
    daemonId,
    machineName,
    displayName: machineName,
    status,
    maxParallelHarnesses: 1,
    appliedMaxParallelHarnesses: null,
    activeHarnesses: 0,
    queuedCommands: 0,
  };
}
const noTelemetry = { getDaemonTelemetry: () => null };

function stubRegistry(): DaemonRegistryPort {
  return {
    issueDaemonCredentials: () => {
      throw new Error("Not exercised by this seam.");
    },
    updateDaemonOnHello: async () => {},
    listKnownDaemons: async () => ["daemon-b", "daemon-a", "daemon-c"],
    listDaemons: async () => [
      summary("daemon-b", "laptop", "offline"),
      summary("daemon-a", "workstation", "offline"),
      summary("daemon-c", "server", "unknown"),
    ],
    verifyDaemonToken: async () => true,
    deregisterDaemon: async () => "not-found" as const,
  };
}

function stubPresence(connectedIds: string[]): DaemonPresencePort {
  return { isDaemonConnected: (daemonId) => connectedIds.includes(daemonId) };
}

describe("listDaemons", () => {
  test("marks socket-connected daemons online in stable id order", async () => {
    const page = await listDaemons(
      stubRegistry(),
      stubPresence(["daemon-b"]),
      {
        getDaemonTelemetry: (daemonId) => daemonId === "daemon-b" ? {
          activeHarnesses: 1,
          queuedCommands: 2,
          desiredMaxParallelHarnesses: 1,
          appliedMaxParallelHarnesses: 1,
        } : null,
      },
      { limit: 10 },
    );

    expect(page).toEqual({
      data: [
        summary("daemon-a", "workstation", "offline"),
        {
          ...summary("daemon-b", "laptop", "offline"),
          status: "online",
          appliedMaxParallelHarnesses: 1,
          activeHarnesses: 1,
          queuedCommands: 2,
        },
        summary("daemon-c", "server", "unknown"),
      ],
      pagination: { nextCursor: null, limit: 10 },
    });
  });

  test("pages with an opaque cursor", async () => {
    const first = await listDaemons(stubRegistry(), stubPresence([]), noTelemetry, { limit: 2 });

    expect(first.data.map((daemon) => daemon.daemonId)).toEqual(["daemon-a", "daemon-b"]);
    expect(first.pagination.nextCursor).toBe(encodeCursor("daemon-b"));

    const second = await listDaemons(stubRegistry(), stubPresence([]), noTelemetry, { limit: 2, cursor: first.pagination.nextCursor });

    expect(second.data.map((daemon) => daemon.daemonId)).toEqual(["daemon-c"]);
    expect(second.pagination.nextCursor).toBeNull();
  });
});
