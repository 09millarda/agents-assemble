import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileExecutionJournalAdapter } from "./FileExecutionJournalAdapter";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("durable command receipts replay completed facts after restart and expose interrupted execution without rerunning it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-journal-"));
  directories.push(directory);
  const journal = new FileExecutionJournalAdapter(directory);
  expect(
    await journal.receive("command-1", "execution-1", "run-1"),
  ).toMatchObject({
    state: "received",
    commandId: "command-1",
    executionId: "execution-1",
    runId: "run-1",
    facts: [],
  });
  await journal.begin("command-1");
  const reopened = new FileExecutionJournalAdapter(directory);
  expect(
    (await reopened.receive("command-1", "execution-1", "run-1")).state,
  ).toBe("interrupted");
  await reopened.finish("command-1", { type: "completed", outcome: "success" });
  const restarted = new FileExecutionJournalAdapter(directory);
  expect(
    await restarted.receive("command-1", "execution-1", "run-1"),
  ).toMatchObject({
    state: "completed",
    commandId: "command-1",
    executionId: "execution-1",
    runId: "run-1",
    facts: [{ type: "completed", outcome: "success" }],
  });
});
