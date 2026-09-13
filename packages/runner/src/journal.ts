import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  authorityDigest,
  canonicalJson,
  type RunnerCommand,
  type RunnerReceipt,
  receiptSchema,
  sha256,
  verifyCommand,
} from "./protocol.ts";

const recordSchema = z.strictObject({
  sequence: z.int().positive(),
  previous: z.string(),
  kind: z.enum(["command", "stage", "receipt", "ack"]),
  data: z.unknown(),
  hash: z.string(),
});
type RecordEntry = z.infer<typeof recordSchema>;
export type InvocationStage =
  | "received"
  | "launch_intent"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "outcome_unknown"
  | "sending"
  | "delivered"
  | "interrupted";
type CommandState = {
  command: RunnerCommand;
  digest: string;
  stage: InvocationStage;
  details: Record<string, unknown>;
};
function writeAll(fd: number, value: string): void {
  const bytes = Buffer.from(value);
  let offset = 0;
  while (offset < bytes.length) {
    const count = writeSync(fd, bytes, offset, bytes.length - offset);
    if (count <= 0) throw new Error("journal_write_incomplete");
    offset += count;
  }
}
export class RunnerJournal {
  readonly journalId: string;
  private fd: number;
  private sequenceValue = 0;
  private previous = "0".repeat(64);
  private commands = new Map<string, CommandState>();
  private invocations = new Map<string, string>();
  private receipts = new Map<string, RunnerReceipt>();
  private acknowledged = new Set<string>();
  private lockPath: string;

  constructor(
    readonly directory: string,
    expectedJournalId?: string,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.lockPath = join(directory, "journal.lock");
    if (existsSync(this.lockPath)) {
      const prior = z
        .object({ pid: z.int().positive() })
        .parse(JSON.parse(readFileSync(this.lockPath, "utf8")));
      try {
        process.kill(prior.pid, 0);
        throw new Error("journal_locked");
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
      }
      unlinkSync(this.lockPath);
    }
    writeFileSync(this.lockPath, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
    try {
      const identityPath = join(directory, "identity.json");
      const journalPath = join(directory, "journal.jsonl");
      if (existsSync(identityPath)) {
        this.journalId = z
          .object({ journalId: z.string().uuid() })
          .parse(JSON.parse(readFileSync(identityPath, "utf8"))).journalId;
        if (!existsSync(journalPath)) throw new Error("journal_lost");
      } else {
        if (existsSync(journalPath) || expectedJournalId) throw new Error("journal_identity_lost");
        this.journalId = randomUUID();
        const identityFd = openSync(identityPath, "wx", 0o600);
        writeAll(identityFd, JSON.stringify({ journalId: this.journalId }));
        fsyncSync(identityFd);
        closeSync(identityFd);
        const emptyFd = openSync(journalPath, "wx", 0o600);
        fsyncSync(emptyFd);
        closeSync(emptyFd);
        const dirFd = openSync(directory, "r");
        fsyncSync(dirFd);
        closeSync(dirFd);
      }
      if (expectedJournalId && expectedJournalId !== this.journalId)
        throw new Error("journal_incarnation_mismatch");
      const content = readFileSync(journalPath, "utf8");
      if (content && !content.endsWith("\n")) throw new Error("journal_corrupt_partial_record");
      for (const line of content.split("\n").filter(Boolean)) {
        const record = recordSchema.parse(JSON.parse(line));
        const { hash, ...unsigned } = record;
        if (
          record.sequence !== this.sequenceValue + 1 ||
          record.previous !== this.previous ||
          sha256(canonicalJson(unsigned)) !== hash
        )
          throw new Error("journal_corrupt_chain");
        this.apply(record);
      }
      this.fd = openSync(journalPath, "a", 0o600);
    } catch (error) {
      unlinkSync(this.lockPath);
      throw error;
    }
  }
  get sequence(): number {
    return this.sequenceValue;
  }
  private append(kind: RecordEntry["kind"], data: unknown): void {
    const unsigned = { sequence: this.sequenceValue + 1, previous: this.previous, kind, data };
    const record = { ...unsigned, hash: sha256(canonicalJson(unsigned)) };
    writeAll(this.fd, `${canonicalJson(record)}\n`);
    fsyncSync(this.fd);
    this.apply(record);
  }
  private apply(record: RecordEntry): void {
    if (record.kind === "command") {
      const command = verifyCommand(record.data);
      this.commands.set(command.commandId, {
        command,
        digest: authorityDigest(command),
        stage: "received",
        details: {},
      });
      if (["start", "prepare", "check"].includes(command.kind))
        this.invocations.set(command.scope.invocationId, command.commandId);
    } else if (record.kind === "stage") {
      const stage = z
        .object({
          commandId: z.string(),
          stage: z.string(),
          details: z.record(z.string(), z.unknown()),
        })
        .parse(record.data);
      const state = this.commands.get(stage.commandId);
      if (!state) throw new Error("journal_missing_command");
      state.stage = stage.stage as InvocationStage;
      state.details = stage.details;
    } else if (record.kind === "receipt") {
      const receipt = receiptSchema.parse(record.data);
      this.receipts.set(receipt.receiptId, receipt);
    } else if (record.kind === "ack") {
      const ack = z.array(z.string()).parse(record.data);
      for (const receiptId of ack) this.acknowledged.add(receiptId);
    }
    this.sequenceValue = record.sequence;
    this.previous = record.hash;
  }
  receive(value: unknown): { fresh: boolean; state: CommandState } {
    const command = verifyCommand(value);
    const existing = this.commands.get(command.commandId);
    if (existing) {
      if (existing.digest !== authorityDigest(command))
        throw new Error("command_identity_conflict");
      return { fresh: false, state: existing };
    }
    if (
      ["start", "prepare", "check"].includes(command.kind) &&
      (this.invocations.has(command.scope.invocationId) ||
        [...this.commands.values()].some(
          (x) =>
            ["start", "prepare", "check"].includes(x.command.kind) &&
            x.command.scope.attemptId === command.scope.attemptId,
        ))
    )
      throw new Error("invocation_already_received");
    this.append("command", command);
    const state = this.commands.get(command.commandId);
    if (!state) throw new Error("journal_command_not_applied");
    return { fresh: true, state };
  }
  stage(commandId: string, stage: InvocationStage, details: Record<string, unknown> = {}): void {
    if (!this.commands.has(commandId)) throw new Error("unknown_command");
    this.append("stage", { commandId, stage, details });
  }
  receipt(
    command: RunnerCommand,
    status: RunnerReceipt["status"],
    details: Record<string, unknown> = {},
  ): RunnerReceipt {
    const receipt = receiptSchema.parse({
      receiptId: randomUUID(),
      commandId: command.commandId,
      scope: command.scope,
      sequence: this.sequenceValue + 1,
      status,
      details,
      createdAt: new Date().toISOString(),
    });
    this.append("receipt", receipt);
    return receipt;
  }
  acknowledge(receiptIds: string[]): void {
    const fresh = receiptIds.filter(
      (value) => this.receipts.has(value) && !this.acknowledged.has(value),
    );
    if (fresh.length) this.append("ack", fresh);
  }
  pendingReceipts(): RunnerReceipt[] {
    return [...this.receipts.values()]
      .filter((receipt) => !this.acknowledged.has(receipt.receiptId))
      .slice(0, 200);
  }
  states(): CommandState[] {
    return [...this.commands.values()];
  }
  state(commandId: string): CommandState | undefined {
    return this.commands.get(commandId);
  }
  recoverUncertain(): void {
    for (const { command, stage } of this.states()) {
      if (["launch_intent", "sending", "running"].includes(stage)) {
        this.stage(command.commandId, "outcome_unknown", {
          reason: "daemon_restart",
          writerCoverage: "incomplete",
        });
        this.receipt(command, "outcome_unknown", {
          reason: "daemon_restart",
          recovery: "manual_reconciliation_required",
          writerCoverage: "incomplete",
        });
      }
    }
  }
  close(): void {
    closeSync(this.fd);
    unlinkSync(this.lockPath);
  }
}
