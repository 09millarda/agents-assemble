import { describe, expect, test } from "bun:test";
import { deregisterDaemon } from "./deregisterDaemon";

describe("deregisterDaemon", () => {
  test("delegates to the registry port", async () => {
    const called: string[] = [];
    await deregisterDaemon(
      {
        listDaemons: async () => [],
        deregisterDaemon: async (daemonId: string) => {
          called.push(daemonId);
        },
      },
      "daemon-1"
    );
    expect(called).toEqual(["daemon-1"]);
  });
});
