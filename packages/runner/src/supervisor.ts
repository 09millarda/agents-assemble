import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { z } from "zod";
import { canonicalJson, type StartCommand, scopeSchema } from "./protocol.ts";

export const supervisorConfigSchema = z.strictObject({
  version: z.literal("aa-supervisor/1"),
  nativeUid: z.int().positive(),
  nativeGid: z.int().positive(),
  nativeHome: z.string().startsWith("/"),
  codexBinary: z.string().startsWith("/"),
  workRoot: z.string().startsWith("/"),
  controlRoot: z.string().startsWith("/"),
  runnerDirectory: z.string().startsWith("/"),
  helperDirectory: z.literal("/opt/agents-assemble/supervisor"),
  path: z.string().min(1),
});
export type SupervisorConfig = z.infer<typeof supervisorConfigSchema>;
export const supervisorReceiptSchema = z.strictObject({
  version: z.literal("aa-supervisor/1"),
  receiptId: z.string(),
  bindingDigest: z.string().regex(/^[a-f0-9]{64}$/),
  binding: z.strictObject({
    scope: scopeSchema,
    commandId: z.string(),
    payloadDigest: z.string(),
    manager: z.strictObject({
      unit: z.string(),
      activationId: z.string(),
      pid: z.int().positive(),
      cgroup: z.string(),
    }),
    bootId: z.string(),
    object: z.strictObject({ device: z.int().nonnegative(), inode: z.int().nonnegative() }),
    incarnation: z.string(),
    profile: z.literal("authenticated_scope_only"),
  }),
  journalSequence: z.int().positive(),
  status: z.enum(["never_started", "contained_local_processes_stopped", "writers_remaining"]),
  eventsDigest: z.string().regex(/^[a-f0-9]{64}$/),
  populated: z.boolean(),
  gateClosed: z.literal(true),
  writerCoverage: z.literal("incomplete"),
  automaticTakeover: z.literal(false),
  observationProfile: z.literal("authenticated_scope_only"),
});
export type SupervisorReceipt = z.infer<typeof supervisorReceiptSchema>;
export type NativeIdentity = Pick<
  SupervisorConfig,
  "nativeUid" | "nativeGid" | "nativeHome" | "path"
>;
const exec = promisify(execFile);
export function nativeSource(identity?: NativeIdentity): NodeJS.ProcessEnv | undefined {
  return identity
    ? {
        PATH: identity.path,
        HOME: identity.nativeHome,
        USER: String(identity.nativeUid),
        LANG: "C.UTF-8",
      }
    : undefined;
}
export function lowPrivilegeCommand(
  command: string,
  args: string[],
  identity?: NativeIdentity,
): { command: string; args: string[] } {
  return identity
    ? {
        command: "/usr/bin/setpriv",
        args: [
          `--reuid=${identity.nativeUid}`,
          `--regid=${identity.nativeGid}`,
          "--clear-groups",
          "--no-new-privs",
          "--",
          command,
          ...args,
        ],
      }
    : { command, args };
}
export async function assertProtectedPath(path: string, privateFile = false): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path)
    throw new Error("protected_path_must_be_canonical_absolute");
  let part = path;
  while (true) {
    const info = await lstat(part);
    if (info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) !== 0)
      throw new Error("unprotected_supervisor_path");
    if (part === path && privateFile && (!info.isFile() || (info.mode & 0o077) !== 0))
      throw new Error("unprotected_supervisor_file");
    const parent = dirname(part);
    if (part === parent) break;
    part = parent;
  }
}
export async function readSupervisorConfig(): Promise<SupervisorConfig> {
  if (process.platform !== "linux" || process.getuid?.() !== 0)
    throw new Error("protected_controller_requires_root");
  const file = "/etc/agents-assemble/supervisor.json";
  await assertProtectedPath(file, true);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return supervisorConfigSchema.parse(JSON.parse(await handle.readFile("utf8")));
  } finally {
    await handle.close();
  }
}
export class ProtectedSupervisor {
  constructor(readonly settings: SupervisorConfig) {
    supervisorConfigSchema.parse(settings);
    if (process.getuid?.() !== 0 || process.platform !== "linux")
      throw new Error("protected_controller_requires_root");
  }
  async verify(runnerDirectory: string): Promise<void> {
    const installed = await readSupervisorConfig();
    if (
      canonicalJson(installed) !== canonicalJson(this.settings) ||
      runnerDirectory !== this.settings.runnerDirectory
    )
      throw new Error("supervisor_configuration_mismatch");
    for (const key of ["workRoot", "controlRoot", "helperDirectory", "runnerDirectory"] as const)
      await assertProtectedPath(this.settings[key]);
    for (const file of [
      join(runnerDirectory, "config.json"),
      join(this.settings.helperDirectory, "supervisor.py"),
    ])
      await assertProtectedPath(file, file.endsWith("config.json"));
    const runner = z
      .object({
        codexBinary: z.string(),
        caFile: z.string(),
        certificateFile: z.string(),
        privateKeyFile: z.string(),
      })
      .parse(JSON.parse(await readFile(join(runnerDirectory, "config.json"), "utf8")));
    if (runner.codexBinary !== this.settings.codexBinary)
      throw new Error("supervisor_native_binary_mismatch");
    for (const path of [runner.caFile, runner.certificateFile, runner.privateKeyFile])
      await assertProtectedPath(path, true);
  }
  private helper(operation: string, instance: string, extra: string[] = []) {
    return exec(
      "/usr/bin/python3",
      [
        join(this.settings.helperDirectory, "supervisor.py"),
        operation,
        "--instance",
        instance,
        ...extra,
      ],
      { timeout: 25000, maxBuffer: 1024 * 1024, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" } },
    );
  }
  async prepare(command: StartCommand): Promise<{ command: string; args: string[] }> {
    const id = command.scope.invocationId;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(id))
      throw new Error("invalid_protected_invocation_identity");
    const requests = join(this.settings.controlRoot, "requests");
    await assertProtectedPath(requests);
    const bytes = canonicalJson({
      version: "aa-supervisor/1",
      command,
      environmentNames: [
        ...Object.keys(command.payload.environment.variables),
        ...command.payload.environment.secretBindings.map((binding) => binding.name),
      ].sort(),
    });
    const file = join(requests, `${id}.json`);
    try {
      const handle = await open(
        file,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const directory = await open(requests, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      await assertProtectedPath(file, true);
      if ((await readFile(file, "utf8")) !== bytes)
        throw new Error("protected_invocation_binding_conflict");
      throw new Error("protected_launch_already_attempted");
    }
    await exec("/usr/bin/systemctl", ["start", `agents-assemble-keeper@${id}.service`], {
      timeout: 20000,
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
    });
    const deadline = performance.now() + 10000;
    while (true) {
      try {
        await this.helper("status", id);
        break;
      } catch (error) {
        if (performance.now() >= deadline) throw error;
        await delay(100);
      }
    }
    return {
      command: "/usr/bin/python3",
      args: [join(this.settings.helperDirectory, "supervisor.py"), "proxy", "--instance", id],
    };
  }
  async stopAndReport(
    command: StartCommand,
    receiptId = `${command.commandId}.stop`,
  ): Promise<SupervisorReceipt> {
    const id = command.scope.invocationId;
    await this.helper("stop", id);
    const response = await this.helper("report", id, ["--receipt-id", receiptId]);
    const receipt = supervisorReceiptSchema.parse(JSON.parse(response.stdout));
    if (
      receipt.binding.commandId !== command.commandId ||
      receipt.binding.payloadDigest !== command.payloadDigest ||
      canonicalJson(receipt.binding.scope) !== canonicalJson(command.scope)
    )
      throw new Error("protected_receipt_binding_mismatch");
    return receipt;
  }
}
