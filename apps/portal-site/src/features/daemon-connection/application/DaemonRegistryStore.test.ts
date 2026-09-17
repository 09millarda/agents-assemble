import { describe, expect, test } from "bun:test";
import type { DaemonSummary } from "@factory/shared-domain";
import type { DaemonRegistryPort } from "../domain/DaemonRegistryPort";
import { createDaemonRegistryStore, type DaemonRegistrySnapshot } from "./DaemonRegistryStore";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createRegistry(overrides: Partial<DaemonRegistryPort> = {}): DaemonRegistryPort {
  return {
    listDaemons: async () => [],
    deregisterDaemon: async () => {},
    ...overrides,
  };
}

const onlineDaemon: DaemonSummary = {
  daemonId: "daemon-1",
  machineName: "studio",
  status: "online",
};

describe("DaemonRegistryStore", () => {
  test("publishes the initial loading state and the first daemon response", async () => {
    const response = createDeferred<DaemonSummary[]>();
    const store = createDaemonRegistryStore(
      createRegistry({ listDaemons: async () => response.promise }),
    );
    const snapshots: DaemonRegistrySnapshot[] = [];
    const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot()));

    const refresh = store.refreshDaemons();
    expect(store.getSnapshot()).toEqual({ daemons: [], isLoading: true, error: null });

    response.resolve([onlineDaemon]);
    await refresh;
    unsubscribe();

    expect(store.getSnapshot()).toEqual({ daemons: [onlineDaemon], isLoading: false, error: null });
    expect(snapshots.at(-1)).toEqual({ daemons: [onlineDaemon], isLoading: false, error: null });
  });

  test("shares one in-flight refresh between callers", async () => {
    const response = createDeferred<DaemonSummary[]>();
    let listCalls = 0;
    const store = createDaemonRegistryStore(
      createRegistry({
        listDaemons: async () => {
          listCalls += 1;
          return response.promise;
        },
      }),
    );

    const firstRefresh = store.refreshDaemons();
    const secondRefresh = store.refreshDaemons();
    response.resolve([onlineDaemon]);
    await Promise.all([firstRefresh, secondRefresh]);

    expect(listCalls).toBe(1);
    expect(store.getSnapshot().daemons).toEqual([onlineDaemon]);
  });

  test("retains the last response when a refresh fails and recovers on the next refresh", async () => {
    let shouldFail = false;
    const store = createDaemonRegistryStore(
      createRegistry({
        listDaemons: async () => {
          if (shouldFail) throw new Error("Factory API is down.");
          return [onlineDaemon];
        },
      }),
    );

    await store.refreshDaemons();
    shouldFail = true;
    await store.refreshDaemons();

    expect(store.getSnapshot()).toEqual({
      daemons: [onlineDaemon],
      isLoading: false,
      error: "Factory API is down.",
    });

    shouldFail = false;
    await store.refreshDaemons();

    expect(store.getSnapshot()).toEqual({ daemons: [onlineDaemon], isLoading: false, error: null });
  });

  test("deregisters a daemon and refreshes the shared response", async () => {
    const deregisteredDaemonIds: string[] = [];
    let listCalls = 0;
    const store = createDaemonRegistryStore(
      createRegistry({
        listDaemons: async () => {
          listCalls += 1;
          return listCalls === 1 ? [onlineDaemon] : [];
        },
        deregisterDaemon: async (daemonId) => {
          deregisteredDaemonIds.push(daemonId);
        },
      }),
    );

    await store.refreshDaemons();
    await store.deregisterDaemon("daemon-1");

    expect(deregisteredDaemonIds).toEqual(["daemon-1"]);
    expect(listCalls).toBe(2);
    expect(store.getSnapshot().daemons).toEqual([]);
  });
});
