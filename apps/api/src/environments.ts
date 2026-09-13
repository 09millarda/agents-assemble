import { DomainError } from "@aa/platform/contracts";
import { digest, newId } from "@aa/platform/crypto";
import { type ApiRouter, envelope } from "@aa/platform/http";
import type { ContextStore } from "@aa/platform/store";
import { z } from "zod";

const variable = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]*$/)
  .refine(
    (name) =>
      ![
        "HOME",
        "PATH",
        "NODE_OPTIONS",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "BASH_ENV",
        "ENV",
        "CODEX_HOME",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
      ].includes(name) && !name.startsWith("AA_"),
    "Reserved or credential environment variable",
  );
const environmentConfigurationSchema = z
  .object({
    name: z.string().min(1).max(100),
    variables: z.record(variable, z.string().max(8192)),
    secretBindings: z
      .array(
        z
          .object({ name: variable, logicalName: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/) })
          .strict(),
      )
      .max(32),
    resolverPolicy: z.enum(["local-file", "environment"]),
    rotationPolicy: z.enum(["pinned", "refresh_per_attempt"]),
  })
  .strict();
export const environmentInputSchema = environmentConfigurationSchema.extend({
  resolverPolicy: z.literal("local-file"),
  rotationPolicy: z.literal("refresh_per_attempt"),
});
// Older requested profiles remain readable; admission separately rejects unsupported policies.
export const environmentProfileSchema = environmentConfigurationSchema
  .extend({ digest: z.string(), revision: z.number().int().positive(), active: z.boolean() })
  .strict();
export type EnvironmentProfile = z.infer<typeof environmentProfileSchema>;
export class Environments {
  constructor(readonly store: ContextStore) {}
  async get(organizationId: string, id: string) {
    return this.store.read(organizationId, (tx) =>
      tx.require<EnvironmentProfile>("environment", id),
    );
  }
  register(router: ApiRouter) {
    router.add({
      method: "get",
      path: "/environments",
      summary: "List environment profiles without secret values",
      response: z.object({ items: z.array(envelope(environmentProfileSchema)) }),
      handler: (req) =>
        this.store.read(req.actor.organizationId, async (tx) => ({
          items: await tx.list<EnvironmentProfile>("environment"),
        })),
    });
    router.add({
      method: "post",
      path: "/environments",
      summary: "Create an immutable environment profile revision",
      auth: "admin",
      body: environmentInputSchema,
      response: envelope(environmentProfileSchema),
      handler: (req) =>
        this.store.command(req.command("create-environment"), async (tx) => {
          const names = req.body.secretBindings.map((binding) => binding.name);
          if (
            new Set(names).size !== names.length ||
            names.some((name) => Object.hasOwn(req.body.variables, name))
          )
            throw new DomainError(
              "binding_conflict",
              "Each environment name must have exactly one binding",
            );
          return tx.put("environment", newId(), {
            ...req.body,
            digest: digest(req.body),
            revision: 1,
            active: true,
          });
        }),
    });
    router.add({
      method: "get",
      path: "/environments/:id",
      summary: "Read the current environment revision",
      response: envelope(environmentProfileSchema),
      handler: (req) => this.get(req.actor.organizationId, req.params.id),
    });
    router.add({
      method: "post",
      path: "/environments/:id/revisions",
      summary: "Version environment configuration while preserving previous revisions",
      auth: "admin",
      body: z
        .object({ expectedVersion: z.number().int().positive(), profile: environmentInputSchema })
        .strict(),
      response: envelope(environmentProfileSchema),
      handler: (req) =>
        this.store.command(
          req.command("revise-environment", { id: req.params.id, ...req.body }),
          async (tx) => {
            const current = await tx.require<EnvironmentProfile>("environment", req.params.id);
            const names = req.body.profile.secretBindings.map((binding) => binding.name);
            if (
              new Set(names).size !== names.length ||
              names.some((name) => Object.hasOwn(req.body.profile.variables, name))
            )
              throw new DomainError("binding_conflict", "Environment binding names must be unique");
            return tx.put(
              "environment",
              current.id,
              {
                ...req.body.profile,
                digest: digest(req.body.profile),
                revision: current.data.revision + 1,
                active: true,
              },
              req.body.expectedVersion,
            );
          },
        ),
    });
  }
}
