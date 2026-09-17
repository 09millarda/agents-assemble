import type { HarnessCapability } from "@factory/workflow";
import type { Database } from "@factory/db";
import type { ProjectRegistryPort } from "../../project-workspace/domain/ProjectWorkspacePort";
import { DrizzleWorkflowStoreAdapter } from "../adapters/DrizzleWorkflowStoreAdapter";
export function buildWorkflowModule(
  database: Database,
  projects: ProjectRegistryPort,
  vapidPublicKey: string | null,
  capabilities: (daemonId: string) => HarnessCapability[] = () => [],
) {
  const store = new DrizzleWorkflowStoreAdapter(
    database,
    projects,
    vapidPublicKey,
    capabilities,
  );
  return { store };
}
