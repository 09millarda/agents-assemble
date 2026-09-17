import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireDaemonProcessLock } from "./acquireDaemonProcessLock";

test("reconnecting reuses the daemon runtime while another process cannot open its journal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-runtime-lock-"));
  const bin = join(directory, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "codex"), "#!/bin/sh\nexit 1\n");
  await chmod(join(bin, "codex"), 0o700);
  const modulePath = new URL("./workflowExecutionContainer.ts", import.meta.url)
    .pathname;
  const script = `import { createWorkflowExecutionContainer } from ${JSON.stringify(modulePath)};await createWorkflowExecutionContainer('daemon-one');await createWorkflowExecutionContainer('daemon-one');console.log('ready');setInterval(()=>{},1000);`;
  const child = Bun.spawn([process.execPath, "-e", script], {
    env: {
      ...process.env,
      FACTORY_DAEMON_STATE_DIR: directory,
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  let release: (() => Promise<void>) | undefined;
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "ready",
    );
    const acquireSecondRuntimeLock = async () => {
      release = await acquireDaemonProcessLock(
        join(directory, "daemon-one"),
        () => {},
      );
    };
    await expect(acquireSecondRuntimeLock()).rejects.toThrow("already owns");
  } finally {
    child.kill("SIGKILL");
    await child.exited;
    await release?.();
    reader.releaseLock();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
