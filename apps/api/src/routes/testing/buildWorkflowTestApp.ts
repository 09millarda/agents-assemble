import { OpenAPIHono } from "@hono/zod-openapi";
import type { DaemonCredentialIssuerPort, DeviceAuthorizationStorePort } from "../../features/device-authorization/domain/DeviceAuthorizationPort";
import type { DaemonCapabilityPort } from "../../features/workflow-delivery/domain/DaemonCapabilityPort";
import type { DaemonRegistryPort } from "../../features/daemon-connection/domain/DaemonConnectionPort";
import type { WorkflowStorePort } from "../../features/workflow-management/domain/WorkflowStorePort";
import { validationHook } from "../../infrastructure/http/validationHook";
import { registerResourceRoutes } from "../registerResourceRoutes";

const daemonRegistry: DaemonRegistryPort = {
  issueDaemonCredentials: async () => ({ daemonId: "daemon-1", authToken: "token", authTokenHash: "hash" }),
  updateDaemonOnHello: async () => {},
  listKnownDaemons: async () => [],
  listDaemons: async () => [],
  verifyDaemonToken: async () => false,
  deregisterDaemon: async () => "not-found",
};

const credentialIssuer: DaemonCredentialIssuerPort = {
  issueDaemonCredentials: async () => ({ daemonId: "daemon-1", authToken: "token", authTokenHash: "hash" }),
};

const deviceStore: DeviceAuthorizationStorePort = {
  saveAuthorization: async () => {},
  findByDeviceCode: async () => null,
  findByUserCode: async () => null,
  updateAuthorization: async () => {},
};

const daemonCapabilities: DaemonCapabilityPort = {
  getCapabilities: () => [],
};

export function buildWorkflowTestApp(store: WorkflowStorePort): OpenAPIHono {
  const app = new OpenAPIHono({ defaultHook: validationHook });
  registerResourceRoutes(app, {
    daemonRegistry,
    daemonCapabilities,
    deviceStore,
    credentialIssuer,
    workflowStore: store,
  });
  return app;
}
