import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { daemons, eq, ne } from "@factory/db";
import { isDaemonDeregistered } from "@factory/shared-domain";
import type { DaemonId, DaemonSummary } from "@factory/shared-domain";
import type { DeregisterOutcome, DaemonRegistryPort } from "../domain/DaemonConnectionPort";
import type { Database } from "@factory/db";

function hashAuthToken(authToken: string): string {
  return createHash("sha256").update(authToken).digest("hex");
}

export class DrizzleDaemonRegistryAdapter implements DaemonRegistryPort {
  constructor(private readonly database: Database) {}

  async issueDaemonCredentials(machineName: string, existingDaemonId?: DaemonId | null) {
    const authToken = randomBytes(24).toString("hex");
    const authTokenHash = hashAuthToken(authToken);
    if (existingDaemonId) {
      const rows = await this.database.select().from(daemons).where(eq(daemons.daemonId, existingDaemonId)).limit(1);
      const existing = rows[0];
      if (existing && !isDaemonDeregistered((existing.status ?? "unknown") as DaemonSummary["status"])) {
        await this.database
          .update(daemons)
          .set({ machineName, status: "online", authTokenHash })
          .where(eq(daemons.daemonId, existingDaemonId));
        return { daemonId: existingDaemonId, authToken, authTokenHash };
      }
    }
    const daemonId = randomBytes(8).toString("hex");
    await this.database.insert(daemons).values({ daemonId, machineName, status: "online", authTokenHash });
    return { daemonId, authToken, authTokenHash };
  }

  async updateDaemonOnHello(daemonId: DaemonId, machineName: string): Promise<void> {
    const rows = await this.database.select().from(daemons).where(eq(daemons.daemonId, daemonId)).limit(1);
    const existing = rows[0];
    if (!existing) return;
    if (isDaemonDeregistered((existing.status ?? "unknown") as DaemonSummary["status"])) return;
    await this.database.update(daemons).set({ machineName, status: "online" }).where(eq(daemons.daemonId, daemonId));
  }

  async verifyDaemonToken(daemonId: string, authToken: string): Promise<boolean> {
    const rows = await this.database.select().from(daemons).where(eq(daemons.daemonId, daemonId)).limit(1);
    const row = rows[0];
    if (!row) return false;
    if (isDaemonDeregistered((row.status ?? "unknown") as DaemonSummary["status"])) return false;
    const expected = Buffer.from(row.authTokenHash);
    const actual = Buffer.from(hashAuthToken(authToken));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async listKnownDaemons() {
    const rows = await this.database
      .select({ daemonId: daemons.daemonId })
      .from(daemons)
      .where(ne(daemons.status, "deregistered"));
    return rows.map((row) => row.daemonId);
  }

  async listDaemons(): Promise<DaemonSummary[]> {
    const rows = await this.database
      .select({ daemonId: daemons.daemonId, machineName: daemons.machineName, status: daemons.status })
      .from(daemons)
      .where(ne(daemons.status, "deregistered"));
    return rows.map(toDaemonSummary);
  }

  async deregisterDaemon(daemonId: DaemonId): Promise<DeregisterOutcome> {
    const rows = await this.database.select().from(daemons).where(eq(daemons.daemonId, daemonId)).limit(1);
    const row = rows[0];
    if (!row) return "not-found";
    if (isDaemonDeregistered((row.status ?? "unknown") as DaemonSummary["status"])) return "already-deregistered";
    await this.database.update(daemons).set({ status: "deregistered" }).where(eq(daemons.daemonId, daemonId));
    return "deregistered";
  }
}

export interface DaemonSummaryRow {
  daemonId: string;
  machineName: string;
  status: string | null;
}

export function toDaemonSummary(row: DaemonSummaryRow): DaemonSummary {
  return {
    daemonId: row.daemonId,
    machineName: row.machineName,
    status: (row.status ?? "unknown") as DaemonSummary["status"],
  };
}

export function filterActiveDaemons(rows: DaemonSummaryRow[]): DaemonSummaryRow[] {
  return rows.filter((row) => (row.status ?? "unknown") !== "deregistered");
}
