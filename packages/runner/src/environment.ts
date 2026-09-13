import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { nativeEnvironment } from "./native.ts";
import { environmentSchema, type WorkCommand } from "./protocol.ts";

const localSecretsSchema = z.record(
  z.string(),
  z.strictObject({ value: z.string().min(1).max(65536), version: z.string().min(1).max(160) }),
);
export async function resolveEnvironment(command: WorkCommand, secretFile?: string) {
  environmentSchema.parse(command.payload.environment);
  const environment = { ...command.payload.environment.variables };
  const values: string[] = [];
  const bindings: { logicalName: string; version: string; provider: "local-file" }[] = [];
  if (command.payload.environment.secretBindings.length) {
    if (!secretFile || !isAbsolute(secretFile)) throw new Error("secret_provider_not_configured");
    const info = await lstat(secretFile);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      info.uid !== process.getuid?.() ||
      info.size > 2 * 1024 * 1024
    )
      throw new Error("secret_provider_file_permissions");
    const available = localSecretsSchema.parse(JSON.parse(await readFile(secretFile, "utf8")));
    for (const binding of command.payload.environment.secretBindings) {
      const secret = available[binding.logicalName];
      if (!secret) throw new Error(`missing_secret_binding:${binding.logicalName}`);
      if (binding.name in environment) throw new Error("duplicate_environment_binding");
      environment[binding.name] = secret.value;
      values.push(secret.value);
      bindings.push({
        logicalName: binding.logicalName,
        version: secret.version,
        provider: "local-file",
      });
    }
  }
  nativeEnvironment(environment);
  return {
    environment,
    values,
    receipt: {
      profileId: command.payload.environment.profileId,
      revision: command.payload.environment.revision,
      resolverPolicy: command.payload.environment.resolverPolicy,
      rotationPolicy: command.payload.environment.rotationPolicy,
      attemptId: command.scope.attemptId,
      bindings,
      resolvedAt: new Date().toISOString(),
    },
  };
}
