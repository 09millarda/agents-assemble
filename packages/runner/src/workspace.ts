import { execFile } from "node:child_process";
import { chown, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { nativeEnvironment } from "./native.ts";
import { payloadDigest, type WorkCommand } from "./protocol.ts";
import { lowPrivilegeCommand, type NativeIdentity, nativeSource } from "./supervisor.ts";

const exec = promisify(execFile);
async function runGit(
  identity: NativeIdentity | undefined,
  cwd: string,
  ...args: string[]
): Promise<string> {
  const launch = lowPrivilegeCommand(
    "/usr/bin/git",
    ["-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never", ...args],
    identity,
  );
  const result = await exec(launch.command, launch.args, {
    cwd,
    env: {
      ...nativeEnvironment({}, nativeSource(identity)),
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
    },
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trim();
}
export type Workspace = {
  directory: string;
  repositoryDirectory: string;
  repositoryUrl: string;
  repositoryId: string;
  baseline: string;
  invocationId: string;
  identity?: NativeIdentity;
};
export const checkpointSchema = z.strictObject({
  version: z.literal("aa-checkpoint/1"),
  repositoryId: z.string(),
  repositoryUrl: z.string(),
  baseline: z.string().regex(/^[a-f0-9]{40}$/),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  tree: z.string().regex(/^[a-f0-9]{40}$/),
  ref: z.string(),
  invocationId: z.string(),
  inputDigest: z.string(),
  manifestDigest: z.string(),
  scope: z.record(z.string(), z.unknown()),
  verifiedAt: z.iso.datetime(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export async function prepareWorkspace(
  root: string,
  command: WorkCommand,
  identity?: NativeIdentity,
): Promise<Workspace> {
  const git = runGit.bind(undefined, identity);
  const { url, commit, repositoryId } = command.payload.repository;
  if (url.startsWith("-") || /[\n\r\0]/.test(url) || url.includes("::"))
    throw new Error("unsupported_repository_transport");
  const attemptRoot = join(resolve(root), command.scope.invocationId);
  await mkdir(attemptRoot, { recursive: false, mode: 0o700 });
  if (identity) await chown(attemptRoot, identity.nativeUid, identity.nativeGid);
  const repositoryDirectory = join(attemptRoot, "repository.git");
  await git(attemptRoot, "clone", "--bare", "--no-local", "--", url, repositoryDirectory);
  const actualUrl = await git(repositoryDirectory, "config", "--get", "remote.origin.url");
  if (actualUrl !== url) throw new Error("repository_binding_mismatch");
  const fetched = await git(repositoryDirectory, "rev-parse", "--verify", `${commit}^{commit}`);
  if (fetched !== commit) throw new Error("baseline_mismatch");
  const directory = join(attemptRoot, "worktree");
  await git(repositoryDirectory, "worktree", "add", "--detach", directory, commit);
  const files = (await git(directory, "ls-files")).split("\n");
  if (files.includes(".gitmodules")) throw new Error("unsupported_submodules");
  for (const file of files.filter((name) => name.endsWith(".gitattributes"))) {
    const attributes = await git(directory, "show", `${commit}:${file}`);
    if (/filter\s*=\s*lfs/.test(attributes)) throw new Error("unsupported_git_lfs");
  }
  return {
    directory,
    repositoryDirectory,
    repositoryUrl: url,
    repositoryId,
    baseline: commit,
    invocationId: command.scope.invocationId,
    ...(identity ? { identity } : {}),
  };
}
export async function createCheckpoint(
  workspace: Workspace,
  command: WorkCommand,
  secrets: string[] = [],
  checkpointId = workspace.invocationId,
): Promise<Checkpoint> {
  const git = runGit.bind(undefined, workspace.identity);
  if (!/^[A-Za-z0-9_.-]{1,160}$/.test(checkpointId)) throw new Error("invalid_checkpoint_identity");
  await git(workspace.directory, "add", "--all");
  const changed = await git(workspace.directory, "diff", "--cached", "--name-only");
  if (changed) {
    await git(
      workspace.directory,
      "-c",
      "user.name=Agents Assemble",
      "-c",
      "user.email=runner@agents-assemble.local",
      "commit",
      "--no-gpg-sign",
      "-m",
      `Checkpoint ${command.scope.attemptId}`,
    );
  }
  const commit = await git(workspace.directory, "rev-parse", "HEAD");
  await git(workspace.directory, "merge-base", "--is-ancestor", workspace.baseline, commit);
  if (secrets.filter(Boolean).length) {
    const filenames = (
      await git(workspace.directory, "ls-tree", "-r", "--name-only", commit)
    ).split("\n");
    for (const filename of filenames.filter(Boolean)) {
      const content = await git(workspace.directory, "show", `${commit}:${filename}`);
      if (secrets.some((secret) => secret && content.includes(secret)))
        throw new Error("checkpoint_contains_resolved_secret");
    }
  }
  const tree = await git(workspace.directory, "rev-parse", `${commit}^{tree}`);
  const ref = `refs/agents-assemble/checkpoints/${workspace.invocationId}/${checkpointId}`;
  const existing = await git(workspace.directory, "ls-remote", "origin", ref);
  if (existing && existing.split(/\s/)[0] !== commit) throw new Error("checkpoint_ref_conflict");
  if (!existing) await git(workspace.directory, "push", "origin", `${commit}:${ref}`);
  const checkpoint = checkpointSchema.parse({
    version: "aa-checkpoint/1",
    repositoryId: workspace.repositoryId,
    repositoryUrl: workspace.repositoryUrl,
    baseline: workspace.baseline,
    commit,
    tree,
    ref,
    invocationId: workspace.invocationId,
    inputDigest: command.scope.inputDigest,
    manifestDigest: payloadDigest(command.payload),
    scope: command.scope,
    verifiedAt: new Date().toISOString(),
  });
  await verifyCheckpoint(join(workspace.repositoryDirectory, ".."), checkpoint, workspace.identity);
  return checkpoint;
}
export async function verifyCheckpoint(
  root: string,
  value: unknown,
  identity?: NativeIdentity,
): Promise<Checkpoint> {
  const git = runGit.bind(undefined, identity);
  const checkpoint = checkpointSchema.parse(value);
  const verification = await mkdtemp(join(resolve(root), "verify-"));
  if (identity) await chown(verification, identity.nativeUid, identity.nativeGid);
  try {
    await git(verification, "init", "--bare", ".");
    await git(verification, "fetch", "--no-tags", "--", checkpoint.repositoryUrl, checkpoint.ref);
    const commit = await git(verification, "rev-parse", "FETCH_HEAD");
    const tree = await git(verification, "rev-parse", "FETCH_HEAD^{tree}");
    if (commit !== checkpoint.commit || tree !== checkpoint.tree)
      throw new Error("checkpoint_verification_mismatch");
    await git(verification, "merge-base", "--is-ancestor", checkpoint.baseline, checkpoint.commit);
    return checkpoint;
  } finally {
    await rm(verification, { recursive: true, force: true });
  }
}
