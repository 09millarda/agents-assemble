import { randomUUID } from "node:crypto";
import { DomainError } from "@aa/platform/contracts";
import { jsonValue } from "@aa/platform/json";
import { ContextStore } from "@aa/platform/store";
import { afterAll, expect, test } from "vitest";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://agents_assemble:local-development-only@127.0.0.1:55433/agents_assemble_test";
const producer = new ContextStore("projects", databaseUrl),
  consumer = new ContextStore("execution", databaseUrl);
afterAll(async () => {
  await producer.close();
  await consumer.close();
});
test("immutable JSON retains reserved own keys and rejects cycles", () => {
  const value = JSON.parse('{"__proto__":{"changed":true},"constructor":1}');
  expect(JSON.stringify(jsonValue.parse(value))).toBe(JSON.stringify(value));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(jsonValue.safeParse(cyclic).success).toBe(false);
});
test("durable rejection advances inbox sequence, transport failure does not, and emitted version is the committed version", async () => {
  const organizationId = randomUUID(),
    id = randomUUID();
  const messages = await producer.command(
    {
      organizationId,
      actorId: "test",
      operation: "durability",
      operationId: randomUUID(),
      request: {},
    },
    async (tx) => {
      const row = await tx.put("probe", id, { state: "initial" });
      const first = await tx.emit("probe.first", row, { id });
      await tx.put("probe", id, { state: "final" }, row.version);
      const second = await tx.emit("probe.second", row, { id });
      return [first, second];
    },
  );
  expect(messages.map((item) => [item.sequence, item.aggregateVersion])).toEqual([
    [1, 2],
    [2, 2],
  ]);
  expect(
    await consumer.consume(messages[0], async (tx) => {
      await tx.put("probe", id, { shouldRollback: true });
      throw new DomainError("rejected", "Deliberate domain rejection");
    }),
  ).toEqual({ accepted: false, code: "rejected" });
  expect(await consumer.read(organizationId, (tx) => tx.get("probe", id))).toBeUndefined();
  await expect(
    consumer.consume(messages[1], async () => {
      throw new Error("transport");
    }),
  ).rejects.toThrow("transport");
  await expect(
    consumer.consume(messages[1], async () => {
      throw new DomainError(
        "checkpoint_pending",
        "retry after durable checkpoint",
        409,
        "same_operation",
      );
    }),
  ).rejects.toThrow("retry after durable checkpoint");
  expect(
    await consumer.consume(messages[1], async (tx) => {
      await tx.put("probe", id, { accepted: true });
      return { accepted: true };
    }),
  ).toEqual({ accepted: true });
  expect(
    await consumer.consume(messages[0], async () => {
      throw new Error("must not repeat rejected work");
    }),
  ).toEqual({ accepted: false, code: "rejected" });
});
