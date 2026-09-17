import { startNotificationDelivery } from "./features/browser-notification/infrastructure/startNotificationDelivery";
import { createServer } from "node:http";
import { DBOS } from "@dbos-inc/dbos-sdk";
import {
  createDatabaseConnection,
  DrizzleWorkflowRuntimeAdapter,
  acquireWorkflowCoordinatorLease,
} from "@factory/db";
import {
  COORDINATOR_VERSION,
  registerWorkflowInterpreter,
} from "./features/workflow-execution/adapters/DBOSWorkflowInterpreter";
import { resolveCoordinatorPort } from "./infrastructure/coordinatorPort";
const databaseUrl = process.env.DATABASE_URL ?? "";
const database = createDatabaseConnection(databaseUrl);
const releaseLease = await acquireWorkflowCoordinatorLease(
  databaseUrl,
  COORDINATOR_VERSION,
  () => {
    console.error("Coordinator database lease was lost; stopping execution.");
    process.exit(1);
  },
);
const runtime = new DrizzleWorkflowRuntimeAdapter(database);
registerWorkflowInterpreter(runtime, (error) => {
  console.error(
    "Coordinator durability failed; restarting to recover persisted work.",
    error,
  );
  process.exit(1);
});
DBOS.setConfig({
  name: "factory-coordinator",
  systemDatabaseUrl: databaseUrl,
  applicationVersion: COORDINATOR_VERSION,
  executorID: "factory-coordinator",
  runAdminServer: false,
});
await DBOS.launch();
const stopNotificationDelivery = startNotificationDelivery(runtime);
const server = createServer((request, response) => {
  response.writeHead(request.url === "/health" ? 200 : 404, {
    "content-type": "application/json",
  });
  response.end(
    JSON.stringify({
      status: "ready",
      coordinatorVersion: COORDINATOR_VERSION,
    }),
  );
});
server.listen(resolveCoordinatorPort(process.env), "0.0.0.0");
async function shutdown() {
  server.close();
  stopNotificationDelivery();
  await DBOS.shutdown({ deregister: true });
  await releaseLease();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
