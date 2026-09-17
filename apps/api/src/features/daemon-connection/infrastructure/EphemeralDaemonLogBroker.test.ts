import { describe, expect, test } from "bun:test";
import { EphemeralDaemonLogBroker } from "./EphemeralDaemonLogBroker";

describe("EphemeralDaemonLogBroker", () => {
  test("discards logs without a subscriber and never replays them", async () => {
    const broker = new EphemeralDaemonLogBroker({
      createId: () => "id-1",
      now: () => new Date("2026-09-17T12:00:00.000Z"),
    });
    const session = broker.startConnection("daemon-1");

    expect(
      broker.publish(
        "daemon-1",
        session,
        "daemon-to-api",
        "websocket",
        '{"secret":"exact"}',
      ),
    ).toBe(false);

    const events: unknown[] = [];
    broker.subscribe("daemon-1", (event) => {
      events.push(event);
    });
    broker.publish(
      "daemon-1",
      session,
      "daemon-to-api",
      "websocket",
      '{"next":"exact"}',
    );
    await Promise.resolve();

    expect(events).toEqual([
      {
        type: "log",
        log: {
          eventId: "id-1",
          daemonId: "daemon-1",
          connectionSessionId: "id-1",
          occurredAt: "2026-09-17T12:00:00.000Z",
          direction: "daemon-to-api",
          source: "websocket",
          payload: '{"next":"exact"}',
        },
      },
    ]);
  });

  test("resets the session on reconnect and rejects stale-session publication", async () => {
    let identifier = 0;
    const broker = new EphemeralDaemonLogBroker({
      createId: () => `id-${++identifier}`,
    });
    const first = broker.startConnection("daemon-1");
    const second = broker.startConnection("daemon-1");
    const events: unknown[] = [];
    broker.subscribe("daemon-1", (event) => {
      events.push(event);
    });

    expect(
      broker.publish("daemon-1", first, "local", "daemon-stdout", "stale"),
    ).toBe(false);
    expect(
      broker.publish("daemon-1", second, "local", "daemon-stdout", "live"),
    ).toBe(true);
    await Promise.resolve();

    expect(events).toHaveLength(1);
    expect((events[0] as { log: { connectionSessionId: string } }).log.connectionSessionId).toBe(second);
  });

  test("fans each new event out to every current subscriber", async () => {
    const broker = new EphemeralDaemonLogBroker();
    const session = broker.startConnection("daemon-1");
    const first: unknown[] = [];
    const second: unknown[] = [];
    broker.subscribe("daemon-1", (event) => { first.push(event); });
    broker.subscribe("daemon-1", (event) => { second.push(event); });

    broker.publish("daemon-1", session, "api-to-daemon", "websocket", "exact");
    await Promise.resolve();

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });

  test("unsubscribing stops delivery and leaves later events discardable", async () => {
    const broker = new EphemeralDaemonLogBroker();
    const session = broker.startConnection("daemon-1");
    const events: unknown[] = [];
    const unsubscribe = broker.subscribe("daemon-1", (event) => {
      events.push(event);
    });
    unsubscribe();

    expect(
      broker.publish("daemon-1", session, "local", "daemon-stdout", "later"),
    ).toBe(false);
    await Promise.resolve();
    expect(events).toEqual([]);
  });

  test("reports events dropped behind a slow subscriber", async () => {
    let releaseFirst!: () => void;
    const firstDelivery = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const events: Array<{ type: string; droppedCount?: number }> = [];
    const broker = new EphemeralDaemonLogBroker({ maximumPendingEvents: 1 });
    const session = broker.startConnection("daemon-1");
    broker.subscribe("daemon-1", async (event) => {
      events.push(event);
      if (events.length === 1) await firstDelivery;
    });

    broker.publish("daemon-1", session, "local", "daemon-stdout", "one");
    broker.publish("daemon-1", session, "local", "daemon-stdout", "two");
    broker.publish("daemon-1", session, "local", "daemon-stdout", "three");
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events.map((event) => event.type)).toEqual(["log", "log", "dropped"]);
    expect(events[2]?.droppedCount).toBe(1);
  });
});
