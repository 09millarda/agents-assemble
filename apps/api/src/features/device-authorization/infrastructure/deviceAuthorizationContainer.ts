import { DrizzleDeviceAuthorizationAdapter } from "../adapters/DrizzleDeviceAuthorizationAdapter";
import { createDatabaseConnection } from "@factory/db";
import type { DaemonCredentialIssuerPort, DeviceAuthorizationStorePort } from "../domain/DeviceAuthorizationPort";
import type { Database } from "@factory/db";

export function createDeviceAuthorizationStore(database?: Database): DeviceAuthorizationStorePort {
  return new DrizzleDeviceAuthorizationAdapter(database ?? createDatabaseConnection(process.env.DATABASE_URL ?? ""));
}

export function buildDeviceAuthorizationModule(store: DeviceAuthorizationStorePort, issuer: DaemonCredentialIssuerPort) {
  return { store, issuer };
}
