import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { createApplication } from "../apps/api/src/app.ts";
import { loadConfig } from "../apps/api/src/config.ts";

const config = await loadConfig();
const prompt = createInterface({ input: stdin, output: stdout });
const email = process.env.AA_ADMIN_EMAIL ?? (await prompt.question("Admin email: "));
const name = process.env.AA_ADMIN_NAME ?? (await prompt.question("Display name: "));
const organizationName =
  process.env.AA_ORGANIZATION ?? (await prompt.question("Organization name: "));
prompt.close();
async function readPassword() {
  if (!stdin.isTTY) throw new Error("Set AA_ADMIN_PASSWORD when standard input is not a terminal");
  stdout.write("Local password (12+ characters): ");
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let password = "";
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString()) {
        if (character === "\u0003") {
          finish();
          reject(new Error("Bootstrap canceled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          resolve(password);
          return;
        }
        if (character === "\u007f") {
          password = password.slice(0, -1);
          continue;
        }
        if (character >= " ") password += character;
      }
    };
    function finish() {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    }
    stdin.on("data", onData);
  });
}
const password = process.env.AA_ADMIN_PASSWORD ?? (await readPassword());
const application = await createApplication(config);
try {
  const account = await application.access.bootstrap({ email, name, organizationName, password });
  stdout.write(`${JSON.stringify({ event: "organization_created", ...account })}\n`);
} finally {
  await application.close();
}
