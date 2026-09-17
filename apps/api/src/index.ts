import { DrizzleWorkflowDaemonGatewayAdapter } from "./features/workflow-delivery/adapters/DrizzleWorkflowDaemonGatewayAdapter";
import { buildWorkflowModule } from "./features/workflow-management/infrastructure/workflowContainer";
import { createServer } from "node:http";
import { OpenAPIHono } from "@hono/zod-openapi";
import { registerOpenApiEndpoints, registerOperationalEndpoints } from "./infrastructure/openapi/factoryApi";
import { registerResourceRoutes } from "./routes/registerResourceRoutes";
import { buildDaemonConnectionModule, createDaemonRegistry } from "./features/daemon-connection/infrastructure/daemonConnectionContainer";
import { buildProjectWorkspaceModule, createProjectRegistry } from "./features/project-workspace/infrastructure/projectWorkspaceContainer";
import { buildDeviceAuthorizationModule, createDeviceAuthorizationStore } from "./features/device-authorization/infrastructure/deviceAuthorizationContainer";
import { DaemonSocketRegistry } from "./features/daemon-connection/infrastructure/daemonSocketRegistry";
import { attachSocketGateway } from "./features/daemon-connection/adapters/SocketGatewayAdapter";
import { createDatabaseConnection } from "@factory/db";
import { createCorsMiddleware } from "./infrastructure/cors";
import type { DaemonRegistryPort } from "./features/daemon-connection/domain/DaemonConnectionPort";
import type { DaemonCredentialIssuerPort } from "./features/device-authorization/domain/DeviceAuthorizationPort";
import { validationHook } from "./infrastructure/http/validationHook";
import { EphemeralDaemonLogBroker } from "./features/daemon-connection/infrastructure/EphemeralDaemonLogBroker";

const database = createDatabaseConnection(process.env.DATABASE_URL ?? "");
const daemonLogs = new EphemeralDaemonLogBroker();
const daemonSockets = new DaemonSocketRegistry(daemonLogs);
const daemonRegistry = createDaemonRegistry(database);
const daemonConnections = buildDaemonConnectionModule(daemonRegistry, daemonSockets, daemonSockets);
const projectWorkspace = buildProjectWorkspaceModule(createProjectRegistry(database));
const workflowModule = buildWorkflowModule(database, projectWorkspace.registry, process.env.VAPID_PUBLIC_KEY ?? null, daemonId => workflowGateway.getCapabilities(daemonId));
const workflowGateway = new DrizzleWorkflowDaemonGatewayAdapter(database, daemonSockets, workflowModule.store);
const deviceAuthorizations = buildDeviceAuthorizationModule(
  createDeviceAuthorizationStore(database),
  daemonRegistry as DaemonRegistryPort & DaemonCredentialIssuerPort
);
const app = new OpenAPIHono({ defaultHook: validationHook });
app.use(createCorsMiddleware());
registerOperationalEndpoints(app);
registerResourceRoutes(app, {
  daemonRegistry: daemonConnections.registry,
  daemonPresence: daemonConnections.presence,
  daemonDisconnection: daemonConnections.disconnection,
  daemonCapabilities: workflowGateway,
  daemonConfiguration: daemonConnections.registry,
  daemonConfigurationDelivery: daemonSockets,
  daemonTelemetry: daemonSockets,
  daemonLogs,
  deviceStore: deviceAuthorizations.store,
  credentialIssuer: deviceAuthorizations.issuer,
  projectRegistry: projectWorkspace.registry,
  workflowStore: workflowModule.store,
});
registerOpenApiEndpoints(app);

const server = createServer(async (nodeRequest, nodeResponse) => {
  const chunks: Buffer[] = [];
  nodeRequest.on("data", (chunk) => chunks.push(chunk));
  nodeRequest.on("end", async () => {
    const url = `http://${nodeRequest.headers.host ?? "localhost"}${nodeRequest.url ?? "/"}`;
    const requestCancellation = new AbortController();
    const request = new Request(url, {
      method: nodeRequest.method,
      headers: nodeRequest.headers as Record<string, string>,
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      signal: requestCancellation.signal,
    });
    const response = await app.fetch(request);
    nodeResponse.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (!response.body) {
      nodeResponse.end();
      return;
    }
    const reader = response.body.getReader();
    nodeResponse.once("close", () => {
      requestCancellation.abort();
      void reader.cancel();
    });
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!nodeResponse.write(Buffer.from(chunk.value))) {
          await new Promise<void>((resolve) => nodeResponse.once("drain", resolve));
        }
      }
      nodeResponse.end();
    } catch (error) {
      if (!nodeResponse.destroyed) nodeResponse.destroy(error as Error);
    }
  });
});
attachSocketGateway(
  server,
  daemonConnections.registry,
  daemonSockets,
  workflowGateway,
  daemonConnections.registry,
);
setInterval(() => { void workflowGateway.deliverPendingCommands().catch(error => console.error("Workflow command delivery failed", error)); }, 1000).unref();

const port = Number(process.env.PORT ?? 3001);
server.listen(port, () => console.log(`factory-api listening on :${port}`));
export { app as factoryApp };
