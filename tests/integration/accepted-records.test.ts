import { randomUUID } from "node:crypto";
import { ContextStore } from "@aa/platform/store";
import { afterAll, beforeAll, expect, test } from "vitest";
import { isolatedDatabase } from "../fixtures/database.ts";

const database = isolatedDatabase(),
  store = new ContextStore("execution", database.url),
  org = randomUUID();
beforeAll(() => database.create());
afterAll(async () => {
  await store.close();
  await database.destroy();
});
const meta = () => ({
  organizationId: org,
  actorId: "contract-test",
  operation: "immutability",
  operationId: randomUUID(),
  request: {},
});
test("PostgreSQL preserves immutable accepted evidence even when a context command tries to rewrite it", async () => {
  const receipt = await store.command(meta(), (tx) =>
    tx.put("human-acceptance", randomUUID(), { approved: true, digest: "a".repeat(64) }),
  );
  await expect(
    store.command(meta(), (tx) =>
      tx.put(
        receipt.kind,
        receipt.id,
        { approved: false, digest: "b".repeat(64) },
        receipt.version,
      ),
    ),
  ).rejects.toThrow("accepted_record_is_immutable");
  expect(await store.read(org, (tx) => tx.get(receipt.kind, receipt.id))).toEqual(receipt);
});
test("assignment progress may be recorded while exact command authority remains immutable", async () => {
  const assignment = await store.command(meta(), (tx) =>
    tx.put("assignment", randomUUID(), {
      status: "issued",
      command: { id: randomUUID(), payloadDigest: "a".repeat(64) },
      runnerId: randomUUID(),
    }),
  );
  const received = await store.command(meta(), (tx) =>
    tx.put(
      assignment.kind,
      assignment.id,
      { ...assignment.data, status: "received" },
      assignment.version,
    ),
  );
  await expect(
    store.command(meta(), (tx) =>
      tx.put(
        received.kind,
        received.id,
        { ...received.data, command: { ...received.data.command, payloadDigest: "b".repeat(64) } },
        received.version,
      ),
    ),
  ).rejects.toThrow("assignment_authority_is_immutable");
  expect(
    (await store.read(org, (tx) => tx.require<typeof received.data>(received.kind, received.id)))
      .data.command,
  ).toEqual(assignment.data.command);
});
test("accepted overall outputs cannot be replaced while recording unrelated run evidence", async () => {
  const run = await store.command(meta(), (tx) =>
    tx.put("run", randomUUID(), {
      status: "completed",
      engine: { nodes: {}, output: { approved: true } },
      holds: {},
    }),
  );
  const observed = await store.command(meta(), (tx) =>
    tx.put(
      run.kind,
      run.id,
      { ...run.data, holds: { observation: { reason: "Late evidence" } } },
      run.version,
    ),
  );
  await expect(
    store.command(meta(), (tx) =>
      tx.put(
        run.kind,
        run.id,
        { ...observed.data, engine: { nodes: {}, output: { approved: false } } },
        observed.version,
      ),
    ),
  ).rejects.toThrow("accepted_run_output_is_immutable");
});

test("a failed run keeps its terminal verdict when later commands attempt to reopen it", async () => {
  const failed = await store.command(meta(), (tx) =>
    tx.put("run", randomUUID(), { status: "failed", engine: { nodes: {} }, holds: {} }),
  );
  await expect(
    store.command(meta(), (tx) =>
      tx.put(failed.kind, failed.id, { ...failed.data, status: "blocked" }, failed.version),
    ),
  ).rejects.toThrow("terminal_verdict_is_immutable");
});

test("provider claims, receipts and delivery build identities cannot be rewritten while Community lifecycle remains mutable", async () => {
  const integrations = new ContextStore("integrations", database.url);
  const community = new ContextStore("community", database.url);
  try {
    for (const kind of ["deployment-claim", "deployment-receipt", "delivery-build", "release"]) {
      const accepted = await integrations.command(meta(), (tx) =>
        tx.put(kind, randomUUID(), { digest: "a".repeat(64), status: "accepted" }),
      );
      await expect(
        integrations.command(meta(), (tx) =>
          tx.put(kind, accepted.id, { ...accepted.data, status: "replaced" }, accepted.version),
        ),
      ).rejects.toThrow("accepted_record_is_immutable");
      expect(await integrations.read(org, (tx) => tx.get(kind, accepted.id))).toEqual(accepted);
    }
    const published = await community.command(meta(), (tx) =>
      tx.put("release", randomUUID(), { digest: "a".repeat(64), status: "active" }),
    );
    const quarantined = await community.command(meta(), (tx) =>
      tx.put(
        "release",
        published.id,
        { ...published.data, status: "quarantined" },
        published.version,
      ),
    );
    expect(quarantined.data.status).toBe("quarantined");
    expect(quarantined.data.digest).toBe(published.data.digest);
  } finally {
    await integrations.close();
    await community.close();
  }
});
