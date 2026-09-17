import { InMemoryWorkflowStore } from "../../features/workflow-management/adapters/testing/InMemoryWorkflowStore";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { z } from "zod";
import type { DaemonPresencePort, DaemonRegistryPort } from "../../features/daemon-connection/domain/DaemonConnectionPort";
import type { DaemonConfiguration, DaemonDetails } from "@factory/shared-domain";
import type { ProjectRegistryPort } from "../../features/project-workspace/domain/ProjectWorkspacePort";
import type { DeviceAuthorizationStorePort } from "../../features/device-authorization/domain/DeviceAuthorizationPort";
import { registerResourceRoutes, type ResourceRouteDependencies } from "../../routes/registerResourceRoutes";
import { validationHook } from "../http/validationHook";

export type FactoryApiDeps = ResourceRouteDependencies;

export const FACTORY_OPENAPI_INFO = {
  title: "Factory API",
  version: "1.0.0",
  description: "File-scoped REST surface for the agent software factory: daemon registry, projects, and device authorization.",
} as const;

const HealthSchema = z.object({ ok: z.literal(true) });

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: { "application/json": { schema: HealthSchema } },
      description: "Liveness probe for Docker and hosted healthchecks.",
    },
  },
});

export function registerOperationalEndpoints(app: OpenAPIHono): void {
  app.openapi(healthRoute, (context) => context.json({ ok: true as const }, 200));
}

export function registerOpenApiEndpoints(app: OpenAPIHono): void {
  app.get("/v1/openapi.json", (context) =>
    context.json(app.getOpenAPI31Document({ openapi: "3.1.0", info: { ...FACTORY_OPENAPI_INFO } }))
  );
  app.get("/v1/docs", swaggerUI({ url: "/v1/openapi.json" }));
}

export function mountFactoryRoutes(app: OpenAPIHono, deps: FactoryApiDeps): void {
  registerOperationalEndpoints(app);
  registerResourceRoutes(app, deps);
  registerOpenApiEndpoints(app);
}

const offlinePresence: DaemonPresencePort = { isDaemonConnected: () => false };

function stubRegistry(): DaemonRegistryPort {
  return {
    issueDaemonCredentials: async (machineName) => ({ daemonId: `daemon-for-${machineName}`, authToken: "token", authTokenHash: "hash" }),
    updateDaemonOnHello: async () => {},
    listKnownDaemons: async () => [],
    listDaemons: async () => [],
    verifyDaemonToken: async () => false,
    deregisterDaemon: async () => "not-found" as const,
  };
}

function stubCapabilities() {
  return { getCapabilities: () => [] };
}

function stubDaemonConfiguration() {
  return {
    findDaemon: async (): Promise<DaemonDetails | null> => null,
    saveDesiredConfiguration: async (
      _daemonId: string,
      _configuration: DaemonConfiguration,
    ): Promise<DaemonDetails | null> => null,
  };
}

function stubProjectRegistry(): ProjectRegistryPort {
  return {
    createProject: async (input) => ({ projectId: "project-1", name: input.name, absolutePath: input.absolutePath, daemonId: null, gitStatus: "unknown", blockedReason: null, enabledWorkflowIds: [] }),
    listProjects: async () => [],
    findProject: async () => null,
    setProjectName: async () => null,
    assignDaemon: async () => null,
    setEnabledWorkflowIds: async () => null,
    setSetupCommand: async () => null,
    markGitStatus: async () => {},
  };
}

function stubStore(): DeviceAuthorizationStorePort {
  return {
    saveAuthorization: async () => {},
    findByDeviceCode: async () => null,
    findByUserCode: async () => null,
    updateAuthorization: async () => {},
  };
}

export function buildSpecFactoryApi(): OpenAPIHono {
  const app = new OpenAPIHono({ defaultHook: validationHook });
  const registry = stubRegistry();
  mountFactoryRoutes(app, {
    daemonRegistry: registry,
    daemonPresence: offlinePresence,
    daemonCapabilities: stubCapabilities(),
    daemonConfiguration: stubDaemonConfiguration(),
    daemonConfigurationDelivery: { sendConfiguration: () => false },
    daemonTelemetry: { getDaemonTelemetry: () => null },
    daemonLogs: { subscribe: () => () => {} },
    deviceStore: stubStore(),
    credentialIssuer: registry,
    projectRegistry: stubProjectRegistry(),
    workflowStore: new InMemoryWorkflowStore(),
  });
  return app;
}

export function generateFactoryOpenApiDocument(): Record<string, unknown> {
  return buildSpecFactoryApi().getOpenAPI31Document({
    openapi: "3.1.0",
    info: { ...FACTORY_OPENAPI_INFO },
  }) as unknown as Record<string, unknown>;
}
