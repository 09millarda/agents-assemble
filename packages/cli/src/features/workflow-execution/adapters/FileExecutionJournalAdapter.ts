import { mkdir, open, readFile, rename, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  ExecutionJournalPort,
  ExecutionJournalRecord,
} from "../domain/ExecutionJournalPort";

/** Atomic fsync-backed receipts survive daemon crashes; unfinished work is never silently repeated. */
export class FileExecutionJournalAdapter implements ExecutionJournalPort {
  private readonly activeCommands = new Set<string>();
  private queue = Promise.resolve();
  constructor(private readonly directory: string) {}

  private path(commandId: string): string {
    return join(
      this.directory,
      `${createHash("sha256").update(commandId).digest("hex")}.json`,
    );
  }

  private async read(
    commandId: string,
  ): Promise<ExecutionJournalRecord | undefined> {
    try {
      return JSON.parse(
        await readFile(this.path(commandId), "utf8"),
      ) as ExecutionJournalRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async write(record: ExecutionJournalRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.path(record.commandId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(record));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    const directory = await open(this.directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const pending = this.queue.then(operation);
    this.queue = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }

  async findExecution(executionId: string): Promise<ExecutionJournalRecord[]> {
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(
          async (file) =>
            JSON.parse(
              await readFile(join(this.directory, file), "utf8"),
            ) as ExecutionJournalRecord,
        ),
    );
    return records
      .filter((record) => record.executionId === executionId)
      .sort((left, right) => left.receivedAt - right.receivedAt);
  }
  receive(
    commandId: string,
    executionId: string,
    runId: string,
  ): Promise<ExecutionJournalRecord> {
    return this.serialize(async () => {
      const existing = await this.read(commandId);
      if (existing) {
        if (existing.executionId !== executionId || existing.runId !== runId)
          throw new Error(
            "Command identity cannot be rebound to another execution or run.",
          );
        if (existing.state === "running" && !this.activeCommands.has(commandId))
          return { ...existing, state: "interrupted" };
        return existing;
      }
      const record: ExecutionJournalRecord = {
        receivedAt: performance.timeOrigin + performance.now(),
        commandId,
        executionId,
        runId,
        state: "received",
        facts: [],
      };
      await this.write(record);
      return record;
    });
  }

  private update(
    commandId: string,
    update: (record: ExecutionJournalRecord) => ExecutionJournalRecord,
  ): Promise<void> {
    return this.serialize(async () => {
      const record = await this.read(commandId);
      if (!record)
        throw new Error("Command must be durably received before execution.");
      await this.write(update(record));
    });
  }

  async begin(commandId: string): Promise<void> {
    await this.update(commandId, (record) => ({ ...record, state: "running" }));
    this.activeCommands.add(commandId);
  }
  append(commandId: string, fact: Record<string, unknown>): Promise<void> {
    return this.update(commandId, (record) => ({
      ...record,
      facts: [...record.facts, fact],
    }));
  }
  async wait(commandId: string, sessionId: string): Promise<void> {
    await this.update(commandId, (record) => ({
      ...record,
      state: "waiting",
      sessionId,
    }));
    this.activeCommands.delete(commandId);
  }
  async finish(
    commandId: string,
    fact: Record<string, unknown>,
  ): Promise<void> {
    await this.update(commandId, (record) => ({
      ...record,
      state: "completed",
      facts: [...record.facts, fact],
    }));
    this.activeCommands.delete(commandId);
  }
}
