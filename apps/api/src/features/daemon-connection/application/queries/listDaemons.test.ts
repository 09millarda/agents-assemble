import { describe, expect, test } from "bun:test";
import { listDaemons } from "./listDaemons";
import { encodeCursor } from "../../../../infrastructure/http/pagination";
import type { DaemonPresencePort, DaemonRegistryPort } from "../../domain/DaemonConnectionPort";

function stubRegistry(): DaemonRegistryPort {
  return {
    issueDaemonCredentials: () => {
      throw new Error("Not exercised by this seam.");
    },
    updateDaemonOnHello: async () => {},
    listKnownDaemons: async () => ["daemon-b", "daemon-a", "daemon-c"],
    listDaemons: async () => [
      { daemonId: "daemon-b", machineName: "laptop", status: "offline" },
      { daemonId: "daemon-a", machineName: "workstation", status: "offline" },
      { daemonId: "daemon-c", machineName: "server", status: "unknown" },
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
    const page = await listDaemons(stubRegistry(), stubPresence(["daemon-b"]), { limit: 10 });

    expect(page).toEqual({
      data: [
        { daemonId: "daemon-a", machineName: "workstation", status: "offline" },
        { daemonId: "daemon-b", machineName: "laptop", status: "online" },
        { daemonId: "daemon-c", machineName: "server", status: "unknown" },
      ],
      pagination: { nextCursor: null, limit: 10 },
    });
  });

  test("pages with an opaque cursor", async () => {
    const first = await listDaemons(stubRegistry(), stubPresence([]), { limit: 2 });

    expect(first.data.map((daemon) => daemon.daemonId)).toEqual(["daemon-a", "daemon-b"]);
    expect(first.pagination.nextCursor).toBe(encodeCursor("daemon-b"));

    const second = await listDaemons(stubRegistry(), stubPresence([]), { limit: 2, cursor: first.pagination.nextCursor });

    expect(second.data.map((daemon) => daemon.daemonId)).toEqual(["daemon-c"]);
    expect(second.pagination.nextCursor).toBeNull();
  });
});
