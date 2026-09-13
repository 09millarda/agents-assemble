import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunnerJournal } from "../src/journal.ts";
import { payloadDigest } from "../src/protocol.ts";
import { makeCommand } from "./support.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "aa-journal-"));
  dirs.push(dir);
  return dir;
}
describe("durable daemon journal", () => {
  it("replays receipts after restart without reacquiring launch authority", () => {
    const dir = directory();
    let journal = new RunnerJournal(dir);
    const journalId = journal.journalId;
    const command = makeCommand();
    command.scope.journalId = journalId;
    expect(journal.receive(command).fresh).toBe(true);
    journal.stage(command.commandId, "launch_intent");
    journal.close();
    journal = new RunnerJournal(dir, journalId);
    journal.recoverUncertain();
    expect(journal.receive(command).fresh).toBe(false);
    expect(journal.state(command.commandId)?.stage).toBe("outcome_unknown");
    const [receipt] = journal.pendingReceipts();
    journal.close();
    journal = new RunnerJournal(dir, journalId);
    expect(journal.pendingReceipts()[0]).toEqual(receipt);
    journal.acknowledge([receipt.receiptId]);
    expect(journal.pendingReceipts()).toEqual([]);
    journal.close();
  });
  it("deduplicates invocation independently and detects payload substitution", () => {
    const journal = new RunnerJournal(directory());
    const command = makeCommand();
    journal.receive(command);
    expect(() => journal.receive({ ...command, commandId: "second-message" })).toThrow(
      "invocation_already_received",
    );
    const payload = { ...command.payload, prompt: "different" };
    expect(() =>
      journal.receive({ ...command, payload, payloadDigest: payloadDigest(payload) }),
    ).toThrow("command_identity_conflict");
    journal.close();
  });
  it("fails closed on missing or damaged local history", () => {
    const dir = directory();
    const journal = new RunnerJournal(dir);
    journal.receive(makeCommand());
    journal.close();
    const file = join(dir, "journal.jsonl");
    writeFileSync(file, readFileSync(file, "utf8").slice(0, -1));
    expect(() => new RunnerJournal(dir)).toThrow("journal_corrupt_partial_record");
  });
});
