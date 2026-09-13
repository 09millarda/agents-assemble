import { serve } from "@hono/node-server";
import { createApplication } from "../../apps/api/src/app.ts";
import { GithubRepositories } from "../../apps/api/src/projects.ts";
import { Worker } from "../../apps/worker/src/worker.ts";

const { TEST_DATABASE_URL, TEST_STATE_DIRECTORY, TEST_GITHUB_URL } = process.env;
if (!TEST_DATABASE_URL || !TEST_STATE_DIRECTORY || !TEST_GITHUB_URL)
  throw new Error("Fixture configuration required");
const app = await createApplication({
  databaseUrl: TEST_DATABASE_URL,
  stateDirectory: TEST_STATE_DIRECTORY,
  sessionKey: "process-conformance-signing-key-32-characters",
  deploymentId: "process-conformance",
  repositories: new GithubRepositories(undefined, TEST_GITHUB_URL),
});
if (process.argv[2] === "worker") {
  const worker = new Worker(app);
  let stopped = false;
  process.on("SIGTERM", () => {
    stopped = true;
  });
  process.stdout.write("WORKER_READY\n");
  while (!stopped) {
    await worker.once();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await app.close();
} else {
  const server = serve({ fetch: app.router.app.fetch, hostname: "127.0.0.1", port: 0 }, (address) =>
    process.stdout.write(`API_PORT=${address.port}\n`),
  );
  process.on("SIGTERM", () => {
    server.close(() => void app.close());
  });
}
