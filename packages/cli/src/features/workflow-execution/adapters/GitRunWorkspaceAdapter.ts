import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type {
  BoundDocument,
  RunWorkspace,
  WorkspaceResult,
} from "@factory/workflow";
import type { RunWorkspacePort } from "../domain/RunWorkspacePort";
import { runLocalProcess } from "./runLocalProcess";

export class GitRunWorkspaceAdapter implements RunWorkspacePort {
  private readonly activeRuns = new Map<string, AbortController>();
  async cancel(runId: string): Promise<void> {
    this.activeRuns.get(runId)?.abort();
  }
  constructor(private readonly directory: string) {}
  private runDirectory(runId: string): string {
    return join(
      this.directory,
      createHash("sha256").update(runId).digest("hex"),
    );
  }
  async prepare(
    runId: string,
    workspace: RunWorkspace,
    recoveryAuthorized = false,
  ): Promise<WorkspaceResult> {
    const cancellation = new AbortController();
    this.activeRuns.set(runId, cancellation);
    if (!isAbsolute(workspace.projectPath))
      throw new Error("Project path must be absolute.");
    const directory = this.runDirectory(runId);
    const metadataPath = join(directory, "workspace.json");
    try {
      const saved = JSON.parse(
        await readFile(metadataPath, "utf8"),
      ) as WorkspaceResult & { setupState?: string };
      if (saved.setupState === "failed" || saved.setupState === "running") {
        if (!recoveryAuthorized)
          throw new Error(
            `Project setup requires recovery. ${saved.setupLog ?? "Setup was interrupted."}`,
          );
        const { setupState: _state, ...retained } = saved;
        return this.runSetup(
          directory,
          metadataPath,
          retained,
          workspace.setupCommand,
          cancellation.signal,
        );
      }
      const { setupState: _setupState, ...result } = saved;
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const git = (...args: string[]) =>
      runLocalProcess(
        "git",
        args,
        workspace.projectPath,
        undefined,
        cancellation.signal,
      );
    const selectedBranch =
      workspace.branch ?? (await git("symbolic-ref", "--short", "HEAD"));
    const pinnedCommit = await git(
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${workspace.pinnedCommit ?? `refs/heads/${selectedBranch}`}^{commit}`,
    );
    const branch = `codex/workflow-${runId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const worktreePath = join(directory, "worktree");
    let repository = workspace.repository;
    let pushRemote = workspace.pushRemote;
    const prBase = workspace.prBase ?? selectedBranch;
    if (workspace.requirePublication) {
      const config = async (key: string) => {
        try {
          return await git("config", "--get", key);
        } catch {
          return undefined;
        }
      };
      pushRemote ??=
        (await config(`branch.${selectedBranch}.pushRemote`)) ??
        (await config("remote.pushDefault")) ??
        (await config(`branch.${selectedBranch}.remote`)) ??
        "origin";
      if (pushRemote.startsWith("-") || pushRemote === ".")
        throw new Error("Publication requires a named GitHub push remote.");
      const remoteUrl = await git("remote", "get-url", "--push", pushRemote);
      const githubRepository = remoteUrl.match(
        /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/,
      )?.[1];
      if (!githubRepository)
        throw new Error(
          "Publication requires an existing github.com push remote; automatic forks are unavailable.",
        );
      if (
        repository &&
        repository.toLowerCase() !== githubRepository.toLowerCase()
      )
        throw new Error(
          "Configured publication repository differs from the Git push destination.",
        );
      repository = githubRepository;
      await git("check-ref-format", "--branch", prBase);
    }
    const result: WorkspaceResult = {
      worktreePath,
      branch,
      pinnedCommit,
      repository,
      pushRemote,
      prBase,
    };
    await git("worktree", "add", "-b", branch, worktreePath, pinnedCommit);
    await writeFile(
      metadataPath,
      JSON.stringify({
        ...result,
        setupState: workspace.setupCommand ? "running" : "completed",
      }),
      { mode: 0o600 },
    );
    return this.runSetup(
      directory,
      metadataPath,
      result,
      workspace.setupCommand,
      cancellation.signal,
    );
  }
  private async runSetup(
    directory: string,
    metadataPath: string,
    result: WorkspaceResult,
    setupCommand?: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceResult> {
    if (!setupCommand) return result;
    const previousLog = result.setupLog
      ? `${result.setupLog}\n\n--- Explicit setup retry ---\n`
      : "";
    await writeFile(
      metadataPath,
      JSON.stringify({ ...result, setupState: "running" }),
      { mode: 0o600 },
    );
    try {
      result.setupLog =
        previousLog +
        (await runLocalProcess(
          "sh",
          ["-c", `{ ${setupCommand}\n} 2>&1`],
          result.worktreePath,
          undefined,
          signal,
        ));
      await writeFile(join(directory, "setup.log"), result.setupLog, {
        mode: 0o600,
      });
      await writeFile(
        metadataPath,
        JSON.stringify({ ...result, setupState: "completed" }),
        { mode: 0o600 },
      );
    } catch (error) {
      result.setupLog =
        previousLog + (error instanceof Error ? error.message : String(error));
      await writeFile(join(directory, "setup.log"), result.setupLog, {
        mode: 0o600,
      });
      await writeFile(
        metadataPath,
        JSON.stringify({ ...result, setupState: "failed" }),
        { mode: 0o600 },
      );
      throw error;
    }
    return result;
  }
  async materialize(
    runId: string,
    executionId: string,
    documents: BoundDocument[],
  ): Promise<string> {
    const directory = join(
      this.runDirectory(runId),
      "documents",
      createHash("sha256").update(executionId).digest("hex"),
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const manifest = await Promise.all(
      documents.map(async (document, index) => {
        const file = `${index + 1}.md`;
        await writeFile(join(directory, file), document.content, {
          mode: 0o600,
        });
        return { ...document, file };
      }),
    );
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 },
    );
    return directory;
  }
  async inspect(workspace: WorkspaceResult): Promise<WorkspaceResult> {
    const indexPath = join(workspace.worktreePath, "..", "review-index");
    const git = (...args: string[]) =>
      runLocalProcess("git", args, workspace.worktreePath, {
        GIT_INDEX_FILE: indexPath,
      });
    await rm(indexPath, { force: true });
    await git("read-tree", "HEAD");
    await git("add", "-A");
    const treeHash = await git("write-tree");
    const diff = await git(
      "diff",
      "--cached",
      "--no-ext-diff",
      "--binary",
      workspace.pinnedCommit,
    );
    await rm(indexPath, { force: true });
    return { ...workspace, treeHash, diff };
  }
}
