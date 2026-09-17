import type {
  DaemonId,
  DaemonLogDirection,
  DaemonLogEnvelope,
  DaemonLogSource,
} from "@factory/shared-domain";

export type DaemonLogStreamEvent =
  | { type: "log"; log: DaemonLogEnvelope }
  | { type: "dropped"; droppedCount: number };

export interface DaemonLogPublicationPort {
  startConnection(daemonId: DaemonId): string;
  endConnection(daemonId: DaemonId, connectionSessionId: string): void;
  publish(
    daemonId: DaemonId,
    connectionSessionId: string,
    direction: DaemonLogDirection,
    source: DaemonLogSource,
    payload: string,
  ): boolean;
}

export interface DaemonLogSubscriptionPort {
  subscribe(
    daemonId: DaemonId,
    listener: (event: DaemonLogStreamEvent) => Promise<void> | void,
  ): () => void;
}
