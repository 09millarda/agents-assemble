import type { Server } from "node:http";
import { attachCollaborationServer } from "@aa/collaboration/socket";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApplication } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createRunnerTlsServer } from "./tls.ts";

const config = await loadConfig();
const app = await createApplication(config);

app.router.app.use("/*", serveStatic({ root: "apps/web/dist" }));
app.router.app.get("*", serveStatic({ path: "apps/web/dist/index.html" }));
const server = serve({
  fetch: app.router.app.fetch,
  port: config.port,
  hostname: config.listenHost,
}) as Server;
const collaboration = attachCollaborationServer(
  server,
  app.access,
  { catalog: app.catalogCollaboration, knowledge: app.knowledge },
  config.webOrigin,
);
const runner = await createRunnerTlsServer(app.router.app, app.fleet.authority);
await new Promise<void>((resolve) => runner.listen(config.runnerPort, "0.0.0.0", resolve));
process.stdout.write(
  `${JSON.stringify({ event: "api_ready", port: config.port, runnerPort: config.runnerPort })}\n`,
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await collaboration.close();
  await Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => runner.close(() => resolve())),
  ]);
  await app.close();
}
process.on("SIGTERM", () => {
  void close();
});
process.on("SIGINT", () => {
  void close();
});
