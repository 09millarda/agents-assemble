import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createCheckpoint, prepareWorkspace, verifyCheckpoint } from "../src/workspace.ts";
import { makeCommand } from "./support.ts";

const exec = promisify(execFile);
describe("Git checkpoint transport", () => {
  it("publishes immutable objects and verifies fresh destination reachability", async () => {
    const root = await mkdtemp(join(tmpdir(), "aa-git-"));
    try {
      const remote = join(root, "upstream.git"),
        source = join(root, "source"),
        workspaces = join(root, "workspaces");
      await exec("git", ["init", "--bare", remote]);
      await exec("git", ["clone", remote, source]);
      await writeFile(join(source, "README.md"), "Original baseline\n");
      await exec("git", ["add", "."], { cwd: source });
      await exec(
        "git",
        ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "baseline"],
        { cwd: source },
      );
      await exec("git", ["push", "origin", "HEAD"], { cwd: source });
      const command = makeCommand();
      command.payload.repository.url = remote;
      command.payload.repository.commit = (
        await exec("git", ["rev-parse", "HEAD"], { cwd: source })
      ).stdout.trim();
      await mkdir(workspaces);
      const workspace = await prepareWorkspace(workspaces, command);
      await writeFile(join(workspace.directory, "feature.txt"), "Implemented\n");
      const checkpoint = await createCheckpoint(workspace, command);
      expect(checkpoint.baseline).toBe(command.payload.repository.commit);
      expect(checkpoint.commit).not.toBe(checkpoint.baseline);
      expect(await verifyCheckpoint(root, checkpoint)).toEqual(checkpoint);
      await expect(verifyCheckpoint(root, { ...checkpoint, tree: "0".repeat(40) })).rejects.toThrow(
        "checkpoint_verification_mismatch",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
