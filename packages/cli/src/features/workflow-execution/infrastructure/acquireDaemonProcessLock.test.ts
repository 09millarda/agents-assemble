import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireDaemonProcessLock } from "./acquireDaemonProcessLock";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
test("the kernel lock excludes another daemon and automatically releases after daemon process death", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-daemon-lock-"));
  directories.push(directory);
  const modulePath = new URL("./acquireDaemonProcessLock.ts", import.meta.url)
    .pathname;
  const script = `import { acquireDaemonProcessLock } from ${JSON.stringify(modulePath)};await acquireDaemonProcessLock(${JSON.stringify(directory)},()=>process.exit(9));console.log('ready');setInterval(()=>{},1000);`;
  const child = Bun.spawn([process.execPath, "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  let release: () => Promise<void> = async () => {};
  try {
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("ready");
    await expect(acquireDaemonProcessLock(directory, () => {})).rejects.toThrow(
      "already owns",
    );
    child.kill("SIGKILL");
    await child.exited;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        release = await acquireDaemonProcessLock(directory, () => {});
        break;
      } catch (error) {
        if (attempt === 19) throw error;
        await Bun.sleep(25);
      }
    }
    await expect(acquireDaemonProcessLock(directory, () => {})).rejects.toThrow(
      "already owns",
    );
  } finally {
    child.kill();
    await release();
    reader.releaseLock();
  }
}, 10000);
