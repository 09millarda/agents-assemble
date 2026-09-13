import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "api"], { stdio: "inherit" }),
  spawn("npm", ["run", "worker"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "--workspace", "@aa/web"], { stdio: "inherit" }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping && code !== 0) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
