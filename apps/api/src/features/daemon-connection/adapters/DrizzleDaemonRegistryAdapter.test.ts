import { describe, expect, test } from "bun:test";
import { filterActiveDaemons, toDaemonSummary } from "./DrizzleDaemonRegistryAdapter";

describe("toDaemonSummary", () => {
  test("maps a persistence row to the domain without leaking credentials", () => {
    const summary = toDaemonSummary({ daemonId: "daemon-1", machineName: "workstation", status: "online" });

    expect(summary).toEqual({ daemonId: "daemon-1", machineName: "workstation", status: "online" });
    expect("authTokenHash" in summary).toBe(false);
  });

  test("falls back to unknown when the stored status is null", () => {
    expect(toDaemonSummary({ daemonId: "daemon-2", machineName: "laptop", status: null }).status).toBe("unknown");
  });

  test("passes deregistered rows through the mapper", () => {
    expect(toDaemonSummary({ daemonId: "daemon-9", machineName: "studio", status: "deregistered" })).toEqual({
      daemonId: "daemon-9",
      machineName: "studio",
      status: "deregistered",
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
