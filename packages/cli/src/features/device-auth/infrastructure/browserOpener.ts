import { spawn } from "node:child_process";

function openerCommand(): string[] | null {
  if (process.platform === "darwin") return ["open"];
  if (process.platform === "win32") return ["cmd", "/c", "start"];
  return ["xdg-open"];
}

export async function openBrowserSafely(url: string): Promise<boolean> {
  const command = openerCommand();
  if (!command) return false;
  return new Promise((resolve) => {
    const child = spawn(command[0], [...command.slice(1), url], { stdio: "ignore", detached: true });
    child.on("error", () => resolve(false));
    child.on("spawn", () => resolve(true));
    child.unref();
  });
}
