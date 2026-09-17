import { spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

/** Linux util-linux flock owns the journal across processes; no stale PID-file recovery. */
export async function acquireDaemonProcessLock(
  directory: string,
  onLockLost: (error: Error) => void,
): Promise<() => Promise<void>> {
  if (process.platform !== "linux") {
    throw new Error(
      "Durable daemon execution currently requires Linux and util-linux flock.",
    );
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(await realpath(directory), "daemon-execution.lock");
  const holder = spawn(
    "flock",
    [
      "--exclusive",
      "--nonblock",
      "--conflict-exit-code",
      "73",
      "--no-fork",
      lockPath,
      "sh",
      "-c",
      "printf 'factory-lock-acquired\\n'; cat >/dev/null",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let acquired = false;
  let releasing = false;
  let stdout = "";
  let stderr = "";
  const closed = new Promise<void>((resolve) =>
    holder.once("close", () => resolve()),
  );
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      releasing = true;
      holder.stdin.end();
      holder.kill("SIGTERM");
      reject(new Error("Could not acquire the daemon execution process lock."));
    }, 5000);
    deadline.unref();
    holder.stdout.setEncoding("utf8");
    holder.stderr.setEncoding("utf8");
    holder.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    holder.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!acquired && stdout.includes("factory-lock-acquired\n")) {
        acquired = true;
        clearTimeout(deadline);
        resolve();
      }
    });
    holder.on("error", (error) => {
      clearTimeout(deadline);
      reject(
        new Error(
          `Linux util-linux flock is required for safe daemon execution: ${error.message}`,
        ),
      );
    });
    holder.on("close", (code) => {
      clearTimeout(deadline);
      if (!acquired)
        reject(
          new Error(
            code === 73
              ? "Another daemon process already owns this execution journal. Stop it before starting another daemon."
              : `Could not acquire the daemon execution process lock: ${stderr || String(code)}`,
          ),
        );
      else if (!releasing)
        onLockLost(
          new Error(
            "The daemon execution process lock was lost; stop execution immediately.",
          ),
        );
    });
  });
  return async () => {
    if (releasing) return;
    releasing = true;
    holder.stdin.end();
    await closed;
  };
}
