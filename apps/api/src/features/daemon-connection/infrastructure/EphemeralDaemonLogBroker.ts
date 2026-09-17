import { randomUUID } from "node:crypto";
import type {
  DaemonId,
  DaemonLogDirection,
  DaemonLogSource,
} from "@factory/shared-domain";
import type {
  DaemonLogPublicationPort,
  DaemonLogStreamEvent,
  DaemonLogSubscriptionPort,
} from "../domain/DaemonLogPort";

interface LogSubscriber {
  listener: (event: DaemonLogStreamEvent) => Promise<void> | void;
  pending: DaemonLogStreamEvent[];
  droppedCount: number;
  delivering: boolean;
  active: boolean;
}

export class EphemeralDaemonLogBroker
  implements DaemonLogPublicationPort, DaemonLogSubscriptionPort
{
  private readonly sessions = new Map<DaemonId, string>();
  private readonly subscribers = new Map<DaemonId, Set<LogSubscriber>>();
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly maximumPendingEvents: number;

  constructor(
    options: {
      createId?: () => string;
      now?: () => Date;
      maximumPendingEvents?: number;
    } = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.maximumPendingEvents = options.maximumPendingEvents ?? 100;
  }

  startConnection(daemonId: DaemonId): string {
    const connectionSessionId = this.createId();
    this.sessions.set(daemonId, connectionSessionId);
    return connectionSessionId;
  }

  endConnection(daemonId: DaemonId, connectionSessionId: string): void {
    if (this.sessions.get(daemonId) === connectionSessionId) {
      this.sessions.delete(daemonId);
    }
  }

  subscribe(
    daemonId: DaemonId,
    listener: (event: DaemonLogStreamEvent) => Promise<void> | void,
  ): () => void {
    const subscriber: LogSubscriber = {
      listener,
      pending: [],
      droppedCount: 0,
      delivering: false,
      active: true,
    };
    const daemonSubscribers = this.subscribers.get(daemonId) ?? new Set();
    daemonSubscribers.add(subscriber);
    this.subscribers.set(daemonId, daemonSubscribers);
    return () => {
      subscriber.active = false;
      subscriber.pending = [];
      subscriber.droppedCount = 0;
      daemonSubscribers.delete(subscriber);
      if (daemonSubscribers.size === 0) this.subscribers.delete(daemonId);
    };
  }

  publish(
    daemonId: DaemonId,
    connectionSessionId: string,
    direction: DaemonLogDirection,
    source: DaemonLogSource,
    payload: string,
  ): boolean {
    if (this.sessions.get(daemonId) !== connectionSessionId) return false;
    const daemonSubscribers = this.subscribers.get(daemonId);
    if (!daemonSubscribers?.size) return false;
    const event: DaemonLogStreamEvent = {
      type: "log",
      log: {
        eventId: this.createId(),
        daemonId,
        connectionSessionId,
        occurredAt: this.now().toISOString(),
        direction,
        source,
        payload,
      },
    };
    for (const subscriber of daemonSubscribers) this.enqueue(subscriber, event);
    return true;
  }

  private enqueue(subscriber: LogSubscriber, event: DaemonLogStreamEvent): void {
    if (!subscriber.active) return;
    if (subscriber.pending.length >= this.maximumPendingEvents) {
      subscriber.droppedCount += 1;
      return;
    }
    subscriber.pending.push(event);
    void this.deliver(subscriber);
  }

  private async deliver(subscriber: LogSubscriber): Promise<void> {
    if (subscriber.delivering) return;
    subscriber.delivering = true;
    try {
      while (subscriber.active && subscriber.pending.length > 0) {
        await subscriber.listener(subscriber.pending.shift()!);
      }
      if (subscriber.active && subscriber.droppedCount > 0) {
        const droppedCount = subscriber.droppedCount;
        subscriber.droppedCount = 0;
        await subscriber.listener({ type: "dropped", droppedCount });
      }
    } finally {
      subscriber.delivering = false;
      if (
        subscriber.active &&
        (subscriber.pending.length > 0 || subscriber.droppedCount > 0)
      ) {
        void this.deliver(subscriber);
      }
    }
  }
}
