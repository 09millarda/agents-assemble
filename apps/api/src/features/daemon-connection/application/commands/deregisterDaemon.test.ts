import { describe, expect, test } from "bun:test";
import { deregisterDaemon } from "./deregisterDaemon";
import type { DaemonRegistryPort, DaemonDisconnectionPort, DeregisterOutcome } from "../../domain/DaemonConnectionPort";

function stubRegistry(outcome: DeregisterOutcome): DaemonRegistryPort {
  return {
    issueDaemonCredentials: () => {
      throw new Error("Not exercised by this seam.");
    },
    updateDaemonOnHello: async () => {},
    listKnownDaemons: async () => [],
    listDaemons: async () => [],
    verifyDaemonToken: async () => true,
    deregisterDaemon: async () => outcome,
  };
}

function stubDisconnection(): DaemonDisconnectionPort & { disconnected: string[] } {
  const disconnected: string[] = [];
  return {
    disconnected,
    disconnectDaemon: (daemonId) => {
      disconnected.push(daemonId);
    },
  };
}

describe("deregisterDaemon", () => {
  test("deregisters a known daemon and closes its socket", async () => {
    const disconnection = stubDisconnection();
    const result = await deregisterDaemon(stubRegistry("deregistered"), disconnection, "daemon-1");

    expect(result.ok).toBe(true);
    expect(disconnection.disconnected).toEqual(["daemon-1"]);
  });

  test("returns not-found for an unknown daemon", async () => {
    const disconnection = stubDisconnection();
    const result = await deregisterDaemon(stubRegistry("not-found"), disconnection, "ghost");

    expect(result).toEqual({ ok: false, error: { code: "DAEMON_NOT_FOUND", message: expect.any(String) } });
    expect(disconnection.disconnected).toEqual([]);
  });

  test("returns gone for a repeat deregistration", async () => {
    const disconnection = stubDisconnection();
    const result = await deregisterDaemon(stubRegistry("already-deregistered"), disconnection, "daemon-1");

    expect(result).toEqual({
      ok: false,
      error: { code: "DAEMON_ALREADY_DEREGISTERED", message: expect.any(String) },
    });
    expect(disconnection.disconnected).toEqual([]);
  });
});
