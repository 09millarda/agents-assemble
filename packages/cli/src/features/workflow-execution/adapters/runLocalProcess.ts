import { spawn } from "node:child_process";
export function runLocalProcess(
  command: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Run cancelled."));
      return;
    }
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const abort = () => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        /* Process already exited. */
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(new Error(`Run cancelled. ${stdout}\n${stderr}`));
        return;
      }
      if (code === 0) resolve(stdout.trimEnd());
      else
        reject(
          new Error(`${command} exited ${String(code)}: ${stderr || stdout}`),
        );
    });
  });
}
