import { createApplication } from "../../api/src/app.ts";
import { loadConfig } from "../../api/src/config.ts";
import { Worker } from "./worker.ts";

const application = await createApplication(await loadConfig()),
  worker = new Worker(application);
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
process.stdout.write(`${JSON.stringify({ event: "worker_ready" })}\n`);
while (!stopped) {
  await worker.once();
  await new Promise((resolve) => setTimeout(resolve, 250));
}
await application.close();
