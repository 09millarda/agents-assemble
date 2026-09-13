import { DomainError } from "@aa/platform/contracts";
import { digest } from "@aa/platform/crypto";
import type { ContextStore, Transaction } from "@aa/platform/store";
import { z } from "zod";
export const scopeConsumerSchema = z.enum(["execution", "integrations"]);
export type ScopeConsumer = z.infer<typeof scopeConsumerSchema>;
export const projectCheckpointSchema = z.strictObject({
  projectId: z.uuid(),
  consumer: scopeConsumerSchema,
  generation: z.int().positive(),
  incarnation: z.uuid(),
  epoch: z.int().positive(),
  status: z.enum(["active", "archived", "suspended"]),
});
export type ProjectCheckpoint = z.infer<typeof projectCheckpointSchema>;
export type ConsumerAuthority = ProjectCheckpoint & { expiresAt: string };
export function scopeIdentity(value: unknown): string {
  const hash = digest(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function installProjectCheckpoint(
  store: ContextStore,
  organizationId: string,
  value: ProjectCheckpoint,
  apply?: (tx: Transaction) => Promise<void>,
) {
  const checkpoint = projectCheckpointSchema.parse(value);
  if (checkpoint.consumer !== store.context)
    throw new DomainError(
      "consumer_scope_mismatch",
      "A context can install only its own project checkpoint",
      403,
    );
  return store.command(
    {
      organizationId,
      actorId: "worker",
      operation: "install-project-checkpoint",
      operationId: digest(checkpoint),
      request: checkpoint,
    },
    async (tx) => {
      const prior = await tx.get<{
        epoch: number;
        status: string;
        generation?: number;
        incarnation?: string;
      }>("project-gate", checkpoint.projectId);
      if (
        prior &&
        ((prior.data.generation ?? 0) > checkpoint.generation ||
          (prior.data.generation === checkpoint.generation &&
            (prior.data.incarnation !== checkpoint.incarnation ||
              prior.data.epoch > checkpoint.epoch)))
      )
        throw new DomainError(
          "stale_consumer_checkpoint",
          "A newer consumer generation or project checkpoint is installed",
          409,
        );
      await tx.put("project-gate", checkpoint.projectId, { ...checkpoint }, prior?.version ?? 0);
      if (apply) await apply(tx);
      const receiptId = scopeIdentity({ checkpoint });
      if (!(await tx.get("consumer-checkpoint-receipt", receiptId)))
        await tx.put("consumer-checkpoint-receipt", receiptId, { checkpoint });
      return { checkpoint, receiptId };
    },
  );
}
export async function assertConsumerAuthority(
  tx: Transaction,
  authority: ConsumerAuthority,
): Promise<void> {
  const gate = await tx.get<ProjectCheckpoint>("project-gate", authority.projectId);
  const { expiresAt, ...checkpoint } = authority;
  if (
    !gate ||
    digest(gate.data) !== digest(checkpoint) ||
    authority.status === "suspended" ||
    new Date(expiresAt) <= (await tx.now())
  )
    throw new DomainError(
      "consumer_checkpoint_required",
      "Fresh authority must match the installed consumer generation and project checkpoint",
      409,
      "same_operation",
    );
}
