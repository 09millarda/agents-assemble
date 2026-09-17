import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { GitRunWorkspaceAdapter } from "./GitRunWorkspaceAdapter";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("runs use separate retained worktrees pinned to committed branch content and materialize documents outside tracked changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-worktree-"));
  directories.push(directory);
  const projectPath = join(directory, "project");
  execFileSync("git", ["init", "-b", "main", projectPath]);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: projectPath, encoding: "utf8" }).trim();
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(projectPath, "code.txt"), "committed\n");
  git("add", ".");
  git("commit", "-m", "Initial");
  const pinnedCommit = git("rev-parse", "HEAD");
  await writeFile(join(projectPath, "code.txt"), "private dirty work\n");
  await writeFile(join(projectPath, ".env"), "PRIVATE=1\n");
  const adapter = new GitRunWorkspaceAdapter(join(directory, "runs"));
  const first = await adapter.prepare("run-1", { projectPath });
  const second = await adapter.prepare("run-2", { projectPath });
  expect(first.pinnedCommit).toBe(pinnedCommit);
  expect(first.branch).toBe("codex/workflow-run-1");
  expect(first.worktreePath).not.toBe(second.worktreePath);
  expect(await readFile(join(first.worktreePath, "code.txt"), "utf8")).toBe(
    "committed\n",
  );
  expect(await readFile(join(projectPath, "code.txt"), "utf8")).toBe(
    "private dirty work\n",
  );
  expect(await Bun.file(join(first.worktreePath, ".env")).exists()).toBe(false);
  const inputsPath = await adapter.materialize("run-1", "execution-1", [
    {
      documentId: "criteria",
      name: "Acceptance criteria",
      revisionId: "rev-1",
      content: "# Acceptance criteria\nShip it.",
    },
  ]);
  expect(inputsPath.startsWith(first.worktreePath + "/")).toBe(false);
  expect(await readFile(join(inputsPath, "manifest.json"), "utf8")).toContain(
    '"revisionId": "rev-1"',
  );
  expect(await adapter.prepare("run-1", { projectPath })).toEqual(first);
});

test("setup failures retain their logs and worktree and require recovery instead of silently skipping setup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-setup-"));
  directories.push(directory);
  const projectPath = join(directory, "project");
  execFileSync("git", ["init", "-b", "main", projectPath]);
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    ],
    { cwd: projectPath },
  );
  const adapter = new GitRunWorkspaceAdapter(join(directory, "runs"));
  const workspace = {
    projectPath,
    setupCommand: "echo setup-started; echo setup-failed >&2; exit 3",
  };
  await expect(adapter.prepare("setup-run", workspace)).rejects.toThrow(
    "setup-failed",
  );
  await expect(adapter.prepare("setup-run", workspace)).rejects.toThrow(
    "setup-failed",
  );
});

test("publication workflows resolve the selected GitHub push destination before the first harness execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-destination-"));
  directories.push(directory);
  const projectPath = join(directory, "project");
  execFileSync("git", ["init", "-b", "feature-base", projectPath]);
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    ],
    { cwd: projectPath },
  );
  execFileSync(
    "git",
    ["remote", "add", "origin", "git@github.com:owner/repository.git"],
    { cwd: projectPath },
  );
  const adapter = new GitRunWorkspaceAdapter(join(directory, "runs"));
  expect(
    await adapter.prepare("publishing-run", {
      projectPath,
      requirePublication: true,
    }),
  ).toMatchObject({
    repository: "owner/repository",
    pushRemote: "origin",
    prBase: "feature-base",
  });
});

test("an explicit retry reruns failed setup in the retained worktree after the dependency is repaired", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-setup-retry-"));
  directories.push(directory);
  const projectPath = join(directory, "project");
  execFileSync("git", ["init", "-b", "main", projectPath]);
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    ],
    { cwd: projectPath },
  );
  const adapter = new GitRunWorkspaceAdapter(join(directory, "runs"));
  const dependency = join(directory, "dependency-ready");
  const workspace = {
    projectPath,
    setupCommand: `test -f '${dependency}' && echo configured`,
  };
  await expect(adapter.prepare("retry-setup-run", workspace)).rejects.toThrow();
  await writeFile(dependency, "ready");
  const recovered = await adapter.prepare("retry-setup-run", workspace, true);
  expect(recovered.setupLog).toContain("configured");
  expect(recovered.branch).toBe("codex/workflow-retry-setup-run");
});

test("cancelling active setup stops subsequent work and retains the run worktree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-cancel-setup-"));
  directories.push(directory);
  const projectPath = join(directory, "project");
  execFileSync("git", ["init", "-b", "main", projectPath]);
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    ],
    { cwd: projectPath },
  );
  const adapter = new GitRunWorkspaceAdapter(join(directory, "runs"));
  const startedPath = join(directory, "started");
  const latePath = join(directory, "late");
  const pending = adapter.prepare("cancel-setup", {
    projectPath,
    setupCommand: `touch '${startedPath}'; sleep 30; touch '${latePath}'`,
  });
  const observed = pending.then(
    () => "completed",
    () => "cancelled",
  );
  for (
    let index = 0;
    index < 100 && !(await Bun.file(startedPath).exists());
    index++
  )
    await Bun.sleep(10);
  await adapter.cancel("cancel-setup");
  expect(await observed).toBe("cancelled");
  expect(await Bun.file(latePath).exists()).toBe(false);
  const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: projectPath,
    encoding: "utf8",
  });
  expect(worktrees).toContain("refs/heads/codex/workflow-cancel-setup");
}, 3000);
