export interface ExecutionJournalRecord {
  receivedAt: number;
  commandId: string;
  executionId: string;
  runId: string;
  state: "received" | "running" | "interrupted" | "waiting" | "completed";
  facts: Record<string, unknown>[];
  sessionId?: string;
}

export interface ExecutionJournalPort {
  findExecution(executionId: string): Promise<ExecutionJournalRecord[]>;
  receive(
    commandId: string,
    executionId: string,
    runId: string,
  ): Promise<ExecutionJournalRecord>;
  begin(commandId: string): Promise<void>;
  append(commandId: string, fact: Record<string, unknown>): Promise<void>;
  wait(commandId: string, sessionId: string): Promise<void>;
  finish(commandId: string, fact: Record<string, unknown>): Promise<void>;
}
