import { deviceAuthorizations, eq } from "@factory/db";
import type { DeviceAuthorizationRecord, DeviceAuthorizationStorePort } from "../domain/DeviceAuthorizationPort";
import type { Database } from "@factory/db";
import type { DeviceAuthorizationStatus } from "@factory/shared-domain";
import { normalizeUserCode } from "@factory/shared-domain";

type DeviceAuthorizationRow = typeof deviceAuthorizations.$inferSelect;

export function toDeviceAuthorizationRecord(row: DeviceAuthorizationRow): DeviceAuthorizationRecord {
  return {
    deviceCode: row.deviceCode,
    userCode: row.userCode,
    status: row.status as DeviceAuthorizationStatus,
    expiresAtMs: row.expiresAt.getTime(),
    machineName: row.machineName,
    pollIntervalSeconds: row.pollIntervalSeconds,
    lastPolledAtMs: row.lastPolledAt ? row.lastPolledAt.getTime() : 0,
    daemonId: row.daemonId,
    authToken: row.authToken,
    requestedDaemonId: row.requestedDaemonId,
  };
}

export class DrizzleDeviceAuthorizationAdapter implements DeviceAuthorizationStorePort {
  constructor(private readonly database: Database) {}

  async saveAuthorization(record: DeviceAuthorizationRecord): Promise<void> {
    await this.database.insert(deviceAuthorizations).values({
      deviceCode: record.deviceCode,
      userCode: normalizeUserCode(record.userCode),
      status: record.status,
      expiresAt: new Date(record.expiresAtMs),
      machineName: record.machineName,
      pollIntervalSeconds: record.pollIntervalSeconds,
      lastPolledAt: record.lastPolledAtMs ? new Date(record.lastPolledAtMs) : null,
      daemonId: record.daemonId,
      authToken: record.authToken,
      requestedDaemonId: record.requestedDaemonId,
    });
  }

  async findByDeviceCode(deviceCode: string): Promise<DeviceAuthorizationRecord | null> {
    const rows = await this.database.select().from(deviceAuthorizations).where(eq(deviceAuthorizations.deviceCode, deviceCode)).limit(1);
    return rows[0] ? toDeviceAuthorizationRecord(rows[0]) : null;
  }

  async findByUserCode(userCode: string): Promise<DeviceAuthorizationRecord | null> {
    const rows = await this.database
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.userCode, normalizeUserCode(userCode)))
      .limit(1);
    return rows[0] ? toDeviceAuthorizationRecord(rows[0]) : null;
  }

  async updateAuthorization(record: DeviceAuthorizationRecord): Promise<void> {
    await this.database
      .update(deviceAuthorizations)
      .set({
        status: record.status,
        pollIntervalSeconds: record.pollIntervalSeconds,
        lastPolledAt: record.lastPolledAtMs ? new Date(record.lastPolledAtMs) : null,
        daemonId: record.daemonId,
        authToken: record.authToken,
      })
      .where(eq(deviceAuthorizations.deviceCode, record.deviceCode));
  }
}
