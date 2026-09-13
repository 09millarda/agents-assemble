import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveEnvironment } from "../src/environment.ts";
import { commandSchema, payloadDigest } from "../src/protocol.ts";
import { makeCommand } from "./support.ts";

test("each fresh attempt resolves current private local values and records only versioned bindings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aa-secrets-"));
  const file = join(directory, "bindings.json");
  try {
    const command = makeCommand();
    command.payload.environment.secretBindings = [
      { name: "DEPLOY_TOKEN", logicalName: "staging.deploy-token" },
    ];
    command.payloadDigest = payloadDigest(command.payload);
    await writeFile(
      file,
      JSON.stringify({
        "staging.deploy-token": { value: "first-private-value", version: "version-1" },
      }),
      { mode: 0o600 },
    );
    const first = await resolveEnvironment(command, file);
    expect(first.environment.DEPLOY_TOKEN).toBe("first-private-value");
    expect(first.receipt).toMatchObject({
      attemptId: command.scope.attemptId,
      resolverPolicy: "local-file",
      rotationPolicy: "refresh_per_attempt",
      bindings: [
        { logicalName: "staging.deploy-token", version: "version-1", provider: "local-file" },
      ],
    });
    expect(JSON.stringify(first.receipt)).not.toContain("first-private-value");
    await writeFile(
      file,
      JSON.stringify({
        "staging.deploy-token": { value: "rotated-private-value", version: "version-2" },
      }),
    );
    const successor = structuredClone(command);
    successor.scope.attemptId = randomUUID();
    const next = await resolveEnvironment(successor, file);
    expect(next.environment.DEPLOY_TOKEN).toBe("rotated-private-value");
    expect(next.receipt.bindings[0].version).toBe("version-2");
    expect(next.receipt.attemptId).not.toBe(first.receipt.attemptId);
    expect(first.receipt.bindings[0].version).toBe("version-1");
    expect(JSON.stringify(next.receipt)).not.toContain("rotated-private-value");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runner ingress rejects unsupported secret resolver and rotation contracts", () => {
  const command = makeCommand();
  for (const policy of [{ resolverPolicy: "environment" }, { rotationPolicy: "pinned" }]) {
    const payload = {
      ...command.payload,
      environment: { ...command.payload.environment, ...policy },
    };
    expect(
      commandSchema.safeParse({ ...command, payload, payloadDigest: payloadDigest(payload) })
        .success,
    ).toBe(false);
  }
});
