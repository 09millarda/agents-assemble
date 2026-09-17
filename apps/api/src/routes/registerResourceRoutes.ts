import type { OpenAPIHono } from "@hono/zod-openapi";
import type { DaemonCapabilityPort } from "../features/workflow-delivery/domain/DaemonCapabilityPort";
import type { DaemonDisconnectionPort, DaemonPresencePort, DaemonRegistryPort } from "../features/daemon-connection/domain/DaemonConnectionPort";
import type { DaemonCredentialIssuerPort, DeviceAuthorizationStorePort } from "../features/device-authorization/domain/DeviceAuthorizationPort";
import type { ProjectRegistryPort } from "../features/project-workspace/domain/ProjectWorkspacePort";
import type { WorkflowStorePort } from "../features/workflow-management/domain/WorkflowStorePort";
import { registerGetDaemonCapabilitiesRoute } from "./v1/daemons/[daemonId]/capabilities.get";
import { registerDeregisterDaemonRoute } from "./v1/daemons/[daemonId]/deregister.post";
import { registerListDaemonsRoute } from "./v1/daemons/index.get";
import { registerReadDeviceAuthorizationRoute } from "./v1/device/authorizations/[deviceCode].get";
import { registerRequestDeviceAuthorizationRoute } from "./v1/device/authorizations/index.post";
import { registerApproveDeviceAuthorizationRoute } from "./v1/device/approve.post";
import { registerDenyDeviceAuthorizationRoute } from "./v1/device/deny.post";
import { registerPollForDeviceTokenRoute } from "./v1/device/token.post";
import { registerCreateProjectRoute } from "./v1/projects/index.post";
import { registerListProjectsRoute } from "./v1/projects/index.get";
import { registerSetProjectNameRoute } from "./v1/projects/[projectId]/name.post";
import { registerAssignDaemonRoute } from "./v1/projects/[projectId]/assign.post";
import { registerSetEnabledWorkflowsRoute } from "./v1/projects/[projectId]/enabled-workflows.post";
import { registerSetProjectSettingsRoute } from "./v1/projects/[projectId]/settings.post";
import { registerCreateBrowserRecipientRoute } from "./v1/browser-recipients/index.post";
import { registerGetBrowserRecipientRoute } from "./v1/browser-recipients/[recipientId].get";
import { registerReplaceBrowserSubscriptionRoute } from "./v1/browser-recipients/[recipientId]/subscription.post";
import { registerSaveWorkflowDefinitionRoute } from "./v1/workflows/index.post";
import { registerListWorkflowDefinitionsRoute } from "./v1/workflows/index.get";
import { registerGetWorkflowDefinitionRoute } from "./v1/workflows/[workflowId].get";
import { registerUpdateWorkflowDefinitionRoute } from "./v1/workflows/[workflowId]/update.post";
import { registerDeleteWorkflowDefinitionRoute } from "./v1/workflows/[workflowId]/delete.post";
import { registerStartWorkflowRunRoute } from "./v1/workflow-runs/index.post";
import { registerGetWorkflowRunRoute } from "./v1/workflow-runs/[runId].get";
import { registerSubmitHumanResponseRoute } from "./v1/workflow-runs/[runId]/commands.post";
import { registerListWorkflowRunsRoute } from "./v1/workflow-runs/index.get";
import { registerListRunDocumentsRoute } from "./v1/workflow-runs/[runId]/documents.get";
import { registerListHumanInteractionsRoute } from "./v1/workflow-runs/[runId]/human-interactions.get";
import { registerGetContextDocumentRoute } from "./v1/documents/[revisionId].get";
import { registerListRunNotificationsRoute } from "./v1/workflow-runs/[runId]/notifications.get";

const offlinePresence: DaemonPresencePort = { isDaemonConnected: () => false };
const noopDisconnection: DaemonDisconnectionPort = { disconnectDaemon: () => {} };

export interface ResourceRouteDependencies {
  daemonRegistry: DaemonRegistryPort;
  daemonPresence?: DaemonPresencePort;
  daemonDisconnection?: DaemonDisconnectionPort;
  daemonCapabilities: DaemonCapabilityPort;
  deviceStore: DeviceAuthorizationStorePort;
  credentialIssuer: DaemonCredentialIssuerPort;
  verificationUri?: string;
  projectRegistry?: ProjectRegistryPort;
  workflowStore?: WorkflowStorePort;
}

export function registerResourceRoutes(
  app: OpenAPIHono,
  dependencies: ResourceRouteDependencies,
): void {
  const presence = dependencies.daemonPresence ?? offlinePresence;
  const disconnection = dependencies.daemonDisconnection ?? noopDisconnection;

  registerGetDaemonCapabilitiesRoute(app, { capabilities: dependencies.daemonCapabilities });
  registerListDaemonsRoute(app, { registry: dependencies.daemonRegistry, presence });
  registerDeregisterDaemonRoute(app, { registry: dependencies.daemonRegistry, disconnection });

  registerRequestDeviceAuthorizationRoute(app, {
    store: dependencies.deviceStore,
    issuer: dependencies.credentialIssuer,
    verificationUri: dependencies.verificationUri,
  });
  registerReadDeviceAuthorizationRoute(app, { store: dependencies.deviceStore });
  registerPollForDeviceTokenRoute(app, { store: dependencies.deviceStore });
  registerApproveDeviceAuthorizationRoute(app, {
    store: dependencies.deviceStore,
    issuer: dependencies.credentialIssuer,
  });
  registerDenyDeviceAuthorizationRoute(app, { store: dependencies.deviceStore });

  if (dependencies.projectRegistry) {
    registerCreateProjectRoute(app, { registry: dependencies.projectRegistry });
    registerListProjectsRoute(app, { registry: dependencies.projectRegistry });
    registerSetProjectNameRoute(app, { registry: dependencies.projectRegistry });
    registerAssignDaemonRoute(app, { registry: dependencies.projectRegistry });
    registerSetEnabledWorkflowsRoute(app, { registry: dependencies.projectRegistry });
    registerSetProjectSettingsRoute(app, { registry: dependencies.projectRegistry });
  }

  if (dependencies.workflowStore) {
    const workflow = { store: dependencies.workflowStore };
    registerStartWorkflowRunRoute(app, workflow);
    registerGetWorkflowRunRoute(app, workflow);
    registerSubmitHumanResponseRoute(app, workflow);
    registerCreateBrowserRecipientRoute(app, workflow);
    registerGetBrowserRecipientRoute(app, workflow);
    registerReplaceBrowserSubscriptionRoute(app, workflow);
    registerSaveWorkflowDefinitionRoute(app, workflow);
    registerListWorkflowDefinitionsRoute(app, workflow);
    registerGetWorkflowDefinitionRoute(app, workflow);
    registerUpdateWorkflowDefinitionRoute(app, workflow);
    registerDeleteWorkflowDefinitionRoute(app, workflow);
    registerListWorkflowRunsRoute(app, workflow);
    registerListRunDocumentsRoute(app, workflow);
    registerListHumanInteractionsRoute(app, workflow);
    registerGetContextDocumentRoute(app, workflow);
    registerListRunNotificationsRoute(app, workflow);
  }
}
