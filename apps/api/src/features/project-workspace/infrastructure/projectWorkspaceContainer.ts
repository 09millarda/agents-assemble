import { DrizzleProjectRegistryAdapter } from "../adapters/DrizzleProjectRegistryAdapter";
import { createDatabaseConnection } from "@factory/db";
import type { Database } from "@factory/db";

export function createProjectRegistry(database?: Database) {
  return new DrizzleProjectRegistryAdapter(database ?? createDatabaseConnection(process.env.DATABASE_URL ?? ""));
}

export function buildProjectWorkspaceModule(registry = createProjectRegistry()) {
  return { registry };
}
